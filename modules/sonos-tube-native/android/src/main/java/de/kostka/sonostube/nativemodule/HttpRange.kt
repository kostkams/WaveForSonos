package de.kostka.sonostube.nativemodule

/** A single satisfiable byte range (inclusive). */
data class ByteRange(val start: Long, val end: Long) {
  val length get() = end - start + 1
}

sealed class RangeResult {
  /** No (usable) Range header: serve the full entity. */
  object Full : RangeResult()
  data class Partial(val range: ByteRange) : RangeResult()
  object Unsatisfiable : RangeResult()
}

object HttpRange {
  /**
   * Parses a `Range: bytes=...` header against [total] bytes. Only the first range of a
   * multi-range request is honoured (Sonos only ever sends one).
   *
   * Per RFC 7233 a syntactically invalid spec (`bytes=5-3`, `bytes=--5`, `bytes=a-b`) is ignored
   * ([RangeResult.Full]); only a valid but unsatisfiable one (first-byte-pos >= size, `bytes=-0`)
   * yields [RangeResult.Unsatisfiable].
   */
  fun parse(header: String?, total: Long): RangeResult {
    if (header.isNullOrBlank()) return RangeResult.Full
    val h = header.trim()
    if (!h.startsWith("bytes=", ignoreCase = true)) return RangeResult.Full
    val spec = h.substring(6).split(',').first().trim()
    val dash = spec.indexOf('-')
    if (dash < 0) return RangeResult.Full
    val a = spec.substring(0, dash).trim()
    val b = spec.substring(dash + 1).trim()
    if (total <= 0) return RangeResult.Full
    return if (a.isEmpty()) {
      val suffix = digits(b) ?: return RangeResult.Full
      if (suffix == 0L) return RangeResult.Unsatisfiable
      val start = maxOf(0, total - suffix)
      RangeResult.Partial(ByteRange(start, total - 1))
    } else {
      val start = digits(a) ?: return RangeResult.Full
      val last = if (b.isEmpty()) null else (digits(b) ?: return RangeResult.Full)
      if (last != null && last < start) return RangeResult.Full
      if (start >= total) return RangeResult.Unsatisfiable
      val end = last?.coerceAtMost(total - 1) ?: (total - 1)
      RangeResult.Partial(ByteRange(start, end))
    }
  }

  /** Non-negative decimal number (digits only, no sign), or null. */
  private fun digits(s: String): Long? =
    if (s.isNotEmpty() && s.all { it in '0'..'9' }) s.toLongOrNull() else null
}
