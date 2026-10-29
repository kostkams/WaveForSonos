package de.kostka.sonostube.nativemodule

import org.schabi.newpipe.extractor.Page
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream

/**
 * Serializes a NewPipe [Page] (url, id, ids, cookies, body) into an opaque,
 * URL-safe string token and back. Pure JVM code (unit-testable).
 *
 * Format: "p1" + base64url(binary), binary written with DataOutputStream.
 */
object PageToken {
  private const val PREFIX = "p1"

  fun encode(page: Page?): String? {
    if (page == null || !Page.isValid(page)) return null
    val bytes = ByteArrayOutputStream()
    DataOutputStream(bytes).use { out ->
      writeNullableString(out, page.url)
      writeNullableString(out, page.id)
      val ids = page.ids
      if (ids == null) out.writeInt(-1) else {
        out.writeInt(ids.size)
        ids.forEach { writeNullableString(out, it) }
      }
      val cookies = page.cookies
      if (cookies == null) out.writeInt(-1) else {
        out.writeInt(cookies.size)
        cookies.forEach { (k, v) ->
          writeNullableString(out, k)
          writeNullableString(out, v)
        }
      }
      val body = page.body
      if (body == null) out.writeInt(-1) else {
        out.writeInt(body.size)
        out.write(body)
      }
    }
    return PREFIX + Base64Url.encode(bytes.toByteArray())
  }

  fun decode(token: String?): Page? {
    if (token.isNullOrEmpty()) return null
    require(token.startsWith(PREFIX)) { "Invalid page token" }
    val raw = Base64Url.decode(token.substring(PREFIX.length))
    DataInputStream(ByteArrayInputStream(raw)).use { input ->
      val url = readNullableString(input)
      val id = readNullableString(input)
      val idCount = input.readInt()
      val ids = if (idCount < 0) null else List(idCount) { readNullableString(input) ?: "" }
      val cookieCount = input.readInt()
      val cookies = if (cookieCount < 0) null else {
        val map = LinkedHashMap<String, String>()
        repeat(cookieCount) {
          val k = readNullableString(input) ?: ""
          val v = readNullableString(input) ?: ""
          map[k] = v
        }
        map
      }
      val bodyLen = input.readInt()
      val body = if (bodyLen < 0) null else ByteArray(bodyLen).also { input.readFully(it) }
      return Page(url, id, ids, cookies, body)
    }
  }

  private fun writeNullableString(out: DataOutputStream, s: String?) {
    if (s == null) {
      out.writeInt(-1)
    } else {
      val b = s.toByteArray(Charsets.UTF_8)
      out.writeInt(b.size)
      out.write(b)
    }
  }

  private fun readNullableString(input: DataInputStream): String? {
    val len = input.readInt()
    if (len < 0) return null
    val b = ByteArray(len)
    input.readFully(b)
    return String(b, Charsets.UTF_8)
  }
}

/** Minimal base64url codec without padding (java.util.Base64 needs API 26). */
object Base64Url {
  private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
  private val REVERSE = IntArray(128) { -1 }.also { r ->
    ALPHABET.forEachIndexed { i, c -> r[c.code] = i }
  }

  fun encode(data: ByteArray): String {
    val sb = StringBuilder((data.size + 2) / 3 * 4)
    var i = 0
    while (i + 2 < data.size) {
      val n = (data[i].toInt() and 0xFF shl 16) or (data[i + 1].toInt() and 0xFF shl 8) or (data[i + 2].toInt() and 0xFF)
      sb.append(ALPHABET[n shr 18 and 63]).append(ALPHABET[n shr 12 and 63])
        .append(ALPHABET[n shr 6 and 63]).append(ALPHABET[n and 63])
      i += 3
    }
    val rem = data.size - i
    if (rem == 1) {
      val n = data[i].toInt() and 0xFF shl 16
      sb.append(ALPHABET[n shr 18 and 63]).append(ALPHABET[n shr 12 and 63])
    } else if (rem == 2) {
      val n = (data[i].toInt() and 0xFF shl 16) or (data[i + 1].toInt() and 0xFF shl 8)
      sb.append(ALPHABET[n shr 18 and 63]).append(ALPHABET[n shr 12 and 63]).append(ALPHABET[n shr 6 and 63])
    }
    return sb.toString()
  }

  fun decode(s: String): ByteArray {
    val clean = s.trimEnd('=')
    val out = ByteArrayOutputStream(clean.length * 3 / 4)
    var buffer = 0
    var bits = 0
    for (c in clean) {
      val v = if (c.code < 128) REVERSE[c.code] else -1
      require(v >= 0) { "Invalid base64 character" }
      buffer = (buffer shl 6) or v
      bits += 6
      if (bits >= 8) {
        bits -= 8
        out.write(buffer shr bits and 0xFF)
      }
    }
    return out.toByteArray()
  }
}
