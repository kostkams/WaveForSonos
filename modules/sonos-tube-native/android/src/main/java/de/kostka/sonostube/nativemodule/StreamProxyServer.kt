package de.kostka.sonostube.nativemodule

import android.util.Log
import java.io.BufferedOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.URLDecoder
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Tiny HTTP/1.1 server (one thread per connection, Connection: close) that proxies
 * YouTube audio for Sonos speakers.
 *
 *  GET|HEAD /stream/<id>.m4a          – byte-exact M4A passthrough with Range support
 *  GET|HEAD /stream/<id>.aac?start=s  – fMP4 → ADTS remux (compatibility mode)
 *  GET|HEAD /local/<id>.<ext>          – local audio file (base64url content URI) with Range support
 *  GET|HEAD /local-art/<sha1>.jpg     – embedded cover art of a local file
 *  GET      /health                   – "ok"
 */
class StreamProxyServer {
  private var serverSocket: ServerSocket? = null
  private var acceptThread: Thread? = null
  private var executor: ExecutorService? = null
  private val openSockets = java.util.Collections.newSetFromMap(java.util.concurrent.ConcurrentHashMap<Socket, Boolean>())

  @Volatile
  var port: Int = -1
    private set

  val isRunning get() = serverSocket?.isClosed == false

  /** Binds to 0.0.0.0:[preferredPort], falling back to a free port. Returns the port. */
  @Synchronized
  fun start(preferredPort: Int = DEFAULT_PORT): Int {
    if (isRunning) return port
    val socket = ServerSocket()
    socket.reuseAddress = true
    try {
      socket.bind(InetSocketAddress(InetAddress.getByName("0.0.0.0"), preferredPort), 64)
    } catch (e: IOException) {
      Log.w(TAG, "Port $preferredPort busy, using a free port", e)
      socket.bind(InetSocketAddress(InetAddress.getByName("0.0.0.0"), 0), 64)
    }
    serverSocket = socket
    port = socket.localPort
    val counter = AtomicInteger()
    val pool = Executors.newCachedThreadPool { r ->
      Thread(r, "SonosTubeProxy-${counter.incrementAndGet()}").apply { isDaemon = true }
    }
    executor = pool
    acceptThread = Thread({
      while (!socket.isClosed) {
        try {
          val client = socket.accept()
          openSockets.add(client)
          pool.execute {
            try {
              handle(client)
            } finally {
              openSockets.remove(client)
              try { client.close() } catch (_: IOException) {}
            }
          }
        } catch (e: SocketException) {
          if (!socket.isClosed) Log.w(TAG, "accept failed", e)
        } catch (e: Exception) {
          Log.w(TAG, "accept failed", e)
        }
      }
    }, "SonosTubeProxy-accept").apply { isDaemon = true; start() }
    Log.i(TAG, "Proxy listening on port $port")
    return port
  }

  @Synchronized
  fun stop() {
    try { serverSocket?.close() } catch (_: IOException) {}
    serverSocket = null
    openSockets.toList().forEach { try { it.close() } catch (_: IOException) {} }
    openSockets.clear()
    executor?.shutdownNow()
    executor = null
    acceptThread = null
    port = -1
  }

  // region request handling

  private class HttpRequest(val method: String, val path: String, val query: Map<String, String>, val headers: Map<String, String>)

  private fun handle(socket: Socket) {
    socket.soTimeout = 30_000
    socket.tcpNoDelay = true
    val input = socket.getInputStream()
    val out = BufferedOutputStream(socket.getOutputStream(), 64 * 1024)
    val request = try {
      readRequest(input) ?: return
    } catch (e: IOException) {
      return
    }
    // Writing can block for a long time while the speaker's buffer is full.
    socket.soTimeout = 0
    try {
      route(request, out)
      out.flush()
    } catch (e: SocketException) {
      // client went away (Sonos closes connections when seeking / skipping) – normal
    } catch (e: IOException) {
      Log.w(TAG, "I/O error serving ${request.path}: ${e.message}")
    } catch (e: Exception) {
      Log.e(TAG, "Error serving ${request.path}", e)
      try { sendText(out, 500, "Internal Server Error", e.message ?: "error", request.method == "HEAD") } catch (_: Exception) {}
    }
  }

  private fun readRequest(input: InputStream): HttpRequest? {
    val buf = ByteArray(16 * 1024)
    var len = 0
    while (true) {
      if (len >= buf.size) throw IOException("Request header too large")
      val r = input.read(buf, len, buf.size - len)
      if (r < 0) return null
      len += r
      val text = String(buf, 0, len, Charsets.ISO_8859_1)
      val headerEnd = text.indexOf("\r\n\r\n").takeIf { it >= 0 } ?: text.indexOf("\n\n").takeIf { it >= 0 }
      if (headerEnd != null) {
        val lines = text.substring(0, headerEnd).split("\n").map { it.trimEnd('\r') }
        val parts = lines.first().split(" ")
        if (parts.size < 2) return null
        val method = parts[0].uppercase(Locale.ROOT)
        val target = parts[1]
        val headers = HashMap<String, String>()
        for (line in lines.drop(1)) {
          val c = line.indexOf(':')
          if (c > 0) headers[line.substring(0, c).trim().lowercase(Locale.ROOT)] = line.substring(c + 1).trim()
        }
        val path = target.substringBefore('?')
        val query = HashMap<String, String>()
        target.substringAfter('?', "").split('&').filter { it.isNotEmpty() }.forEach {
          val k = it.substringBefore('=')
          val v = it.substringAfter('=', "")
          query[URLDecoder.decode(k, "UTF-8")] = URLDecoder.decode(v, "UTF-8")
        }
        return HttpRequest(method, path, query, headers)
      }
    }
  }

  private fun route(req: HttpRequest, out: OutputStream) {
    val head = req.method == "HEAD"
    if (req.method != "GET" && !head) {
      sendText(out, 405, "Method Not Allowed", "method not allowed", false)
      return
    }
    if (req.path == "/health") {
      sendText(out, 200, "OK", "ok", head)
      return
    }
    LOCAL_PATH.matchEntire(req.path)?.let {
      serveLocal(it.groupValues[1], it.groupValues[2], req, out, head)
      return
    }
    LOCAL_ART_PATH.matchEntire(req.path)?.let {
      serveLocalArt(it.groupValues[1], out, head)
      return
    }
    val m = STREAM_PATH.matchEntire(req.path)
    if (m == null) {
      sendText(out, 404, "Not Found", "not found", head)
      return
    }
    val videoId = m.groupValues[1]
    when (m.groupValues[2]) {
      "m4a" -> serveM4a(videoId, req, out, head)
      "aac" -> serveAdts(videoId, req, out, head)
    }
  }

  private fun resolveOrError(videoId: String, out: OutputStream, head: Boolean): ResolvedAudio? {
    return try {
      GoogleVideo.resolveWithLength(videoId)
    } catch (e: YouTubeException) {
      Log.w(TAG, "resolve $videoId failed: ${e.code} ${e.message}")
      val status = if (e.code == "ERR_NETWORK") 502 else 404
      sendText(out, status, if (status == 502) "Bad Gateway" else "Not Found", "${e.code}: ${e.message}", head)
      null
    }
  }

  private fun serveM4a(videoId: String, req: HttpRequest, out: OutputStream, head: Boolean) {
    val audio = resolveOrError(videoId, out, head) ?: return
    val total = audio.contentLength
    if (total <= 0) {
      sendText(out, 502, "Bad Gateway", "unknown content length", head)
      return
    }
    val headers = linkedMapOf(
      "Content-Type" to "audio/mp4",
      "Accept-Ranges" to "bytes",
      "Cache-Control" to "no-cache"
    )
    val range: ByteRange
    val status: Int
    when (val r = HttpRange.parse(req.headers["range"], total)) {
      is RangeResult.Unsatisfiable -> {
        headers["Content-Range"] = "bytes */$total"
        writeHead(out, 416, "Range Not Satisfiable", headers + ("Content-Length" to "0"))
        return
      }
      is RangeResult.Partial -> {
        range = r.range
        status = 206
        headers["Content-Range"] = "bytes ${range.start}-${range.end}/$total"
      }
      RangeResult.Full -> {
        range = ByteRange(0, total - 1)
        status = 200
      }
    }
    headers["Content-Length"] = range.length.toString()
    writeHead(out, status, if (status == 206) "Partial Content" else "OK", headers)
    if (head) return
    out.flush()
    UpstreamInputStream(videoId, range.start, range.end).use { upstream ->
      val buf = ByteArray(64 * 1024)
      while (true) {
        val n = upstream.read(buf)
        if (n < 0) break
        out.write(buf, 0, n)
      }
    }
  }

  private fun serveAdts(videoId: String, req: HttpRequest, out: OutputStream, head: Boolean) {
    val audio = resolveOrError(videoId, out, head) ?: return
    val total = audio.contentLength
    val startSec = req.query["start"]?.toDoubleOrNull()?.coerceAtLeast(0.0) ?: 0.0

    // Fetch the prefix (ftyp + moov + sidx) and parse it.
    var prefixLen = if (audio.indexEnd > 0) audio.indexEnd.toLong() + 1 else 128L * 1024
    if (total > 0) prefixLen = minOf(prefixLen, total)
    var header: Mp4Header? = null
    var lastError: Exception? = null
    for (attempt in 0 until 4) {
      try {
        val prefix = GoogleVideo.readRange(videoId, 0, prefixLen - 1)
        header = Fmp4.parseHeader(prefix)
        break
      } catch (e: IOException) {
        lastError = e
        if (total > 0 && prefixLen >= total) break
        prefixLen = if (total > 0) minOf(total, prefixLen * 2) else prefixLen * 2
      }
    }
    if (header == null) {
      Log.w(TAG, "Could not parse MP4 header for $videoId", lastError)
      sendText(out, 502, "Bad Gateway", "could not parse mp4 header: ${lastError?.message}", head)
      return
    }

    val headers = linkedMapOf(
      "Content-Type" to "audio/aac",
      "Cache-Control" to "no-cache",
      "Accept-Ranges" to "none"
    )
    writeHead(out, 200, "OK", headers)
    if (head) return
    out.flush()

    val init = header.init
    val startTicksMedia = (startSec * init.timescale).toLong()
    var fragmentOffset = header.firstFragmentOffset
    val sidx = header.sidx
    if (sidx != null && startSec > 0 && sidx.timescale > 0) {
      val startTicksSidx = (startSec * sidx.timescale).toLong()
      fragmentOffset = sidx.locate(startTicksSidx).first
    }
    val end = if (total > 0) total - 1 else Long.MAX_VALUE / 2
    UpstreamInputStream(videoId, fragmentOffset, end).use { upstream ->
      Fmp4.remuxToAdts(init, java.io.BufferedInputStream(upstream, 64 * 1024), out, startTicksMedia)
    }
  }

  private fun serveLocal(id: String, ext: String, req: HttpRequest, out: OutputStream, head: Boolean) {
    val uri = LocalAudio.decodeId(id)
    if (uri == null) {
      sendText(out, 400, "Bad Request", "bad id", head)
      return
    }
    // Probe the length first, then reopen at the requested offset.
    val total = try {
      LocalAudio.open(uri, 0).use { it.length }
    } catch (e: Exception) {
      Log.w(TAG, "local file not readable: $uri", e)
      sendText(out, 404, "Not Found", "file not readable (removed or permission lost)", head)
      return
    }
    val headers = linkedMapOf(
      "Content-Type" to LocalAudio.mimeForExtension(ext),
      "Cache-Control" to "no-cache"
    )
    var start = 0L
    var end = total - 1
    var status = 200
    if (total > 0) {
      headers["Accept-Ranges"] = "bytes"
      when (val r = HttpRange.parse(req.headers["range"], total)) {
        is RangeResult.Unsatisfiable -> {
          headers["Content-Range"] = "bytes */$total"
          writeHead(out, 416, "Range Not Satisfiable", headers + ("Content-Length" to "0"))
          return
        }
        is RangeResult.Partial -> {
          start = r.range.start
          end = r.range.end
          status = 206
          headers["Content-Range"] = "bytes $start-$end/$total"
        }
        RangeResult.Full -> Unit
      }
      headers["Content-Length"] = (end - start + 1).toString()
    } else {
      headers["Accept-Ranges"] = "none"
    }
    writeHead(out, status, if (status == 206) "Partial Content" else "OK", headers)
    if (head) return
    out.flush()
    LocalAudio.open(uri, start).use { file ->
      val buf = ByteArray(64 * 1024)
      var remaining = if (total > 0) end - start + 1 else Long.MAX_VALUE
      while (remaining > 0) {
        val n = file.stream.read(buf, 0, minOf(buf.size.toLong(), remaining).toInt())
        if (n < 0) break
        out.write(buf, 0, n)
        remaining -= n
      }
    }
  }

  private fun serveLocalArt(name: String, out: OutputStream, head: Boolean) {
    val file = LocalAudio.artFile(name)
    if (file == null) {
      sendText(out, 404, "Not Found", "no cover", head)
      return
    }
    writeHead(
      out, 200, "OK",
      mapOf("Content-Type" to "image/jpeg", "Content-Length" to file.length().toString(), "Cache-Control" to "max-age=86400")
    )
    if (head) return
    file.inputStream().use { it.copyTo(out, 64 * 1024) }
  }

  private fun writeHead(out: OutputStream, status: Int, reason: String, headers: Map<String, String>) {
    val sb = StringBuilder()
    sb.append("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n")
    sb.append("Server: WaveForSonos\r\n")
    sb.append("Connection: close\r\n")
    for ((k, v) in headers) sb.append(k).append(": ").append(v).append("\r\n")
    sb.append("\r\n")
    out.write(sb.toString().toByteArray(Charsets.ISO_8859_1))
  }

  private fun sendText(out: OutputStream, status: Int, reason: String, body: String, head: Boolean) {
    val bytes = body.toByteArray(Charsets.UTF_8)
    writeHead(out, status, reason, mapOf("Content-Type" to "text/plain; charset=utf-8", "Content-Length" to bytes.size.toString()))
    if (!head) out.write(bytes)
    out.flush()
  }

  // endregion

  companion object {
    private const val TAG = "SonosTubeProxy"
    const val DEFAULT_PORT = 8080
    private val LOCAL_PATH = Regex("^/local/([A-Za-z0-9_-]{8,4000})\\.([a-z0-9]{2,5})$")
    private val LOCAL_ART_PATH = Regex("^/local-art/([0-9a-f]{40}\\.jpg)$")
    private val STREAM_PATH = Regex("^/stream/([A-Za-z0-9_-]{6,20})\\.(m4a|aac)$")
  }
}
