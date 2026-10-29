package de.kostka.sonostube.nativemodule

import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Hits real YouTube. Runs only with SONOSTUBE_ONLINE=1 in the environment. */
class OnlineSmokeTest {
  private fun online() = assumeTrue(System.getenv("SONOSTUBE_ONLINE") == "1")

  @Test
  fun searchResolveAndRemux() {
    online()
    @Suppress("UNCHECKED_CAST")
    val page = YouTubeRepository.search("rick astley never gonna give you up", "videos", null)
    val items = page["items"] as List<Map<String, Any?>>
    println("search: ${items.size} items, first=${items.firstOrNull()}")
    assertTrue(items.isNotEmpty())
    val next = YouTubeRepository.search("rick astley never gonna give you up", "videos", page["nextPage"] as String?)
    println("page2: ${(next["items"] as List<*>).size} items")

    val audio = GoogleVideo.resolveWithLength("dQw4w9WgXcQ")
    println("resolved itag=${audio.itag} len=${audio.contentLength} ua=${audio.userAgent} index=${audio.indexStart}-${audio.indexEnd}")
    assertTrue(audio.contentLength > 0)

    val prefix = GoogleVideo.readRange("dQw4w9WgXcQ", 0, (if (audio.indexEnd > 0) audio.indexEnd.toLong() else 131071L))
    val header = Fmp4.parseHeader(prefix)
    println("mp4: ${header.init} sidxRefs=${header.sidx?.references?.size} first=${header.firstFragmentOffset}")

    val out = java.io.ByteArrayOutputStream()
    val upstream = UpstreamInputStream("dQw4w9WgXcQ", header.firstFragmentOffset, minOf(audio.contentLength - 1, header.firstFragmentOffset + 300_000))
    try {
      Fmp4.remuxToAdts(header.init, java.io.BufferedInputStream(upstream), out)
    } catch (e: java.io.EOFException) {
      // truncated range on purpose
    }
    println("adts bytes: ${out.size()}")
    assertTrue(out.size() > 10_000)

    @Suppress("UNCHECKED_CAST")
    val pl = YouTubeRepository.getPlaylist("PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI", null)
    println("playlist: ${pl["title"]} items=${(pl["items"] as List<*>).size} next=${pl["nextPage"] != null}")
  }

  @Test
  fun proxyServesRangesAndAdts() {
    online()
    val server = StreamProxyServer()
    val port = server.start(18080)
    try {
      fun get(path: String, range: String? = null): Pair<Int, Map<String, String>> {
        val c = java.net.URL("http://127.0.0.1:$port$path").openConnection() as java.net.HttpURLConnection
        range?.let { c.setRequestProperty("Range", it) }
        val code = c.responseCode
        val headers = c.headerFields.filterKeys { it != null }.mapValues { it.value.joinToString() }
        val body = (if (code < 400) c.inputStream else c.errorStream)?.use { s ->
          val buf = ByteArray(65536); var total = 0L
          while (total < 400_000) { val n = s.read(buf); if (n < 0) break; total += n }
          total
        }
        println("$path range=$range -> $code len=$body headers=$headers")
        c.disconnect()
        return code to headers
      }
      assertTrue(get("/health").first == 200)
      val (code, h) = get("/stream/dQw4w9WgXcQ.m4a", "bytes=1000000-1099999")
      assertTrue(code == 206)
      assertTrue(h["Content-Range"] == "bytes 1000000-1099999/3449447" || h["Content-Range"]!!.startsWith("bytes 1000000-1099999/"))
      assertTrue(get("/stream/dQw4w9WgXcQ.aac?start=120").first == 200)
    } finally {
      server.stop()
    }
  }

  /** Checks that [data] is a sequence of ADTS frames (the last one may be cut off). Returns the frame count. */
  private fun assertAdts(data: ByteArray): Int {
    var p = 0
    var frames = 0
    while (p + 7 <= data.size) {
      val sync = ((data[p].toInt() and 0xFF) shl 4) or ((data[p + 1].toInt() and 0xF0) shr 4)
      assertTrue("ADTS sync at $p (frame $frames)", sync == 0xFFF)
      val len = ((data[p + 3].toInt() and 0x03) shl 11) or ((data[p + 4].toInt() and 0xFF) shl 3) or ((data[p + 5].toInt() and 0xE0) shr 5)
      assertTrue("frame length $len", len > 7)
      p += len
      frames++
    }
    return frames
  }

  /** Stops a stream copy after [limit] bytes. */
  private class LimitedOutput(private val limit: Int) : java.io.ByteArrayOutputStream() {
    override fun write(b: ByteArray, off: Int, len: Int) {
      super.write(b, off, len)
      if (size() >= limit) throw Limit()
    }
  }

  private class Limit : RuntimeException()

  @Test
  fun madeForKidsVideoFallsBackToMuxedStream() {
    online()
    val id = "gfmmhVqW6kM"
    val audio = GoogleVideo.resolveWithLength(id)
    println("kids: itag=${audio.itag} muxed=${audio.muxed} len=${audio.contentLength} durationMs=${audio.durationMs}")
    assertTrue(audio.muxed)
    assertTrue(audio.contentLength > 0)

    val t0 = System.currentTimeMillis()
    val table = MuxedAudio.sampleTable(audio)
    val lastSec = table.times.last().toDouble() / table.timescale
    println("kids: ${table.count} audio samples, aac=${table.aac}, timescale=${table.timescale}, last=${"%.1f".format(lastSec)} s, first offset=${table.offsets.first()}, parse ${System.currentTimeMillis() - t0} ms")
    assertTrue(table.count > 100)
    assertTrue((1 until table.count).all { table.offsets[it] > table.offsets[it - 1] })

    for (start in listOf(0.0, 60.0)) {
      val out = LimitedOutput(300_000)
      val t1 = System.currentTimeMillis()
      try {
        MuxedAudio.streamAdts(id, table, start, out)
      } catch (_: Limit) {
      }
      val frames = assertAdts(out.toByteArray())
      println("kids: start=$start -> ${out.size()} B ADTS, $frames frames, first sample ${table.indexAt(start)}, ${System.currentTimeMillis() - t1} ms")
      assertTrue(out.size() >= 300_000)
    }
  }

  @Test
  fun proxyServesMuxedVideoAsAdts() {
    online()
    val server = StreamProxyServer()
    val port = server.start(18081)
    try {
      for (path in listOf("/stream/gfmmhVqW6kM.aac", "/stream/gfmmhVqW6kM.aac?start=60", "/stream/gfmmhVqW6kM.m4a")) {
        val c = java.net.URL("http://127.0.0.1:$port$path").openConnection() as java.net.HttpURLConnection
        val code = c.responseCode
        val type = c.contentType
        val body = java.io.ByteArrayOutputStream()
        if (code == 200) c.inputStream.use { s ->
          val buf = ByteArray(65536)
          while (body.size() < 200_000) { val n = s.read(buf); if (n < 0) break; body.write(buf, 0, n) }
        }
        c.disconnect()
        val frames = assertAdts(body.toByteArray())
        println("$path -> $code $type ${body.size()} B, $frames ADTS frames")
        assertTrue(code == 200)
        assertTrue(type == "audio/aac")
        assertTrue(body.size() >= 200_000)
      }
    } finally {
      server.stop()
    }
  }
}
