package de.kostka.sonostube.nativemodule

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.TimeUnit

class UpstreamHttpException(val code: Int, message: String) : IOException(message)

/**
 * Fetches byte ranges of a googlevideo stream in small chunks via the `&range=a-b`
 * query parameter (avoids YouTube's throttling of long single downloads).
 */
object GoogleVideo {
  private const val TAG = "SonosTubeUpstream"
  const val CHUNK_SIZE = 1024L * 1024L // 1 MiB

  val client: OkHttpClient by lazy {
    OkHttpDownloader.get().client.newBuilder()
      .connectTimeout(15, TimeUnit.SECONDS)
      .readTimeout(30, TimeUnit.SECONDS)
      .followRedirects(true)
      .retryOnConnectionFailure(true)
      .build()
  }

  private fun requestBuilder(audio: ResolvedAudio, url: String): Request.Builder {
    val b = Request.Builder().url(url)
      .header("User-Agent", audio.userAgent)
      .header("Accept", "*/*")
      .header("Accept-Encoding", "identity")
    if (audio.isWebClient) {
      b.header("Origin", "https://www.youtube.com")
      b.header("Referer", "https://www.youtube.com/")
    }
    return b
  }

  /** Opens [start, endInclusive] of the stream. Caller must close the response. */
  fun openRange(audio: ResolvedAudio, start: Long, endInclusive: Long): Response {
    val url = audio.url + (if (audio.url.contains('?')) "&" else "?") + "range=$start-$endInclusive"
    val response = client.newCall(requestBuilder(audio, url).get().build()).execute()
    if (!response.isSuccessful) {
      val code = response.code
      response.close()
      throw UpstreamHttpException(code, "googlevideo responded HTTP $code for range $start-$endInclusive")
    }
    return response
  }

  /** Total stream length via HEAD (used when neither itag info nor `clen` provide it). */
  fun probeLength(audio: ResolvedAudio): Long {
    client.newCall(requestBuilder(audio, audio.url).head().build()).execute().use { r ->
      if (r.isSuccessful) {
        r.header("Content-Length")?.toLongOrNull()?.let { if (it > 0) return it }
      }
    }
    // Fallback: a 1-byte ranged request via the Range header exposes the total in Content-Range.
    client.newCall(requestBuilder(audio, audio.url).header("Range", "bytes=0-0").get().build()).execute().use { r ->
      val cr = r.header("Content-Range") ?: return -1
      return cr.substringAfter('/', "").toLongOrNull() ?: -1
    }
  }

  /** Resolve with a known total length, probing upstream if needed. */
  fun resolveWithLength(videoId: String, forceRefresh: Boolean = false): ResolvedAudio {
    val audio = YouTubeRepository.resolveAudio(videoId, forceRefresh)
    if (audio.contentLength > 0) return audio
    val len = try { probeLength(audio) } catch (e: IOException) { Log.w(TAG, "length probe failed", e); -1L }
    return audio.copy(contentLength = len)
  }

  /** Reads a whole (small) range into memory. */
  fun readRange(videoId: String, start: Long, endInclusive: Long): ByteArray {
    UpstreamInputStream(videoId, start, endInclusive).use { return it.readBytes() }
  }
}

/**
 * Sequential stream over [start, endInclusive] of a video's audio, fetched lazily in
 * chunks. Re-resolves the stream URL once per chunk on 403/410 (expired / invalidated URL)
 * and retries transient I/O errors from the current position.
 */
class UpstreamInputStream(
  private val videoId: String,
  start: Long,
  private val endInclusive: Long
) : InputStream() {
  private var position = start
  private var current: InputStream? = null
  private var currentResponse: Response? = null
  private var currentChunkEnd = -1L
  private var closed = false

  private fun openNextChunk() {
    closeCurrent()
    val chunkEnd = minOf(endInclusive, position + GoogleVideo.CHUNK_SIZE - 1)
    var attempt = 0
    var refreshed = false
    while (true) {
      try {
        val audio = YouTubeRepository.resolveAudio(videoId)
        val resp = GoogleVideo.openRange(audio, position, chunkEnd)
        currentResponse = resp
        current = resp.body!!.byteStream()
        currentChunkEnd = chunkEnd
        return
      } catch (e: UpstreamHttpException) {
        if ((e.code == 403 || e.code == 410) && !refreshed) {
          refreshed = true
          YouTubeRepository.invalidateAudio(videoId)
          try {
            YouTubeRepository.resolveAudio(videoId, forceRefresh = true)
          } catch (re: YouTubeException) {
            throw IOException("Re-resolving $videoId failed: ${re.message}", re)
          }
          continue
        }
        if (e.code in 500..599 && attempt < 2) { attempt++; Thread.sleep(300L * attempt); continue }
        throw e
      } catch (e: YouTubeException) {
        // Callers treat upstream trouble as I/O errors (mid-stream: just close the connection).
        throw IOException("Resolving $videoId failed: ${e.message}", e)
      } catch (e: IOException) {
        if (attempt < 2 && !closed) { attempt++; Thread.sleep(300L * attempt); continue }
        throw e
      }
    }
  }

  override fun read(): Int {
    val one = ByteArray(1)
    val n = read(one, 0, 1)
    return if (n <= 0) -1 else one[0].toInt() and 0xFF
  }

  override fun read(b: ByteArray, off: Int, len: Int): Int {
    if (closed) throw IOException("closed")
    if (len == 0) return 0
    var transientRetries = 0
    while (true) {
      if (position > endInclusive) return -1
      if (current == null || position > currentChunkEnd) openNextChunk()
      val toRead = minOf(len.toLong(), currentChunkEnd - position + 1).toInt()
      val n = try {
        current!!.read(b, off, toRead)
      } catch (e: IOException) {
        if (closed || transientRetries >= 2) throw e
        transientRetries++
        closeCurrent()
        continue
      }
      if (n < 0) {
        // Upstream ended the chunk early; reopen from the current position.
        if (transientRetries >= 2) throw IOException("Upstream ended prematurely at $position")
        transientRetries++
        closeCurrent()
        continue
      }
      position += n
      return n
    }
  }

  override fun skip(n: Long): Long {
    if (n <= 0) return 0
    val target = minOf(endInclusive + 1, position + n)
    val skipped = target - position
    if (current != null && target <= currentChunkEnd) {
      // Drain within the current chunk.
      var remaining = skipped
      val buf = ByteArray(8192)
      while (remaining > 0) {
        val r = read(buf, 0, minOf(buf.size.toLong(), remaining).toInt())
        if (r < 0) break
        remaining -= r
      }
      return skipped - remaining
    }
    closeCurrent()
    position = target
    return skipped
  }

  private fun closeCurrent() {
    try { currentResponse?.close() } catch (_: Exception) {}
    currentResponse = null
    current = null
    currentChunkEnd = -1
  }

  override fun close() {
    closed = true
    closeCurrent()
  }
}
