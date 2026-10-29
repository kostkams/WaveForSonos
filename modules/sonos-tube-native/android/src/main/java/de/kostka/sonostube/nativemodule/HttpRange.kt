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
      val suffix = b.toLongOrNull() ?: return RangeResult.Full
      if (suffix <= 0) return RangeResult.Unsatisfiable
      val start = maxOf(0, total - suffix)
      RangeResult.Partial(ByteRange(start, total - 1))
    } else {
      val start = a.toLongOrNull() ?: return RangeResult.Full
      if (start >= total) return RangeResult.Unsatisfiable
      val end = if (b.isEmpty()) total - 1 else (b.toLongOrNull() ?: return RangeResult.Full).coerceAtMost(total - 1)
      if (end < start) return RangeResult.Unsatisfiable
      RangeResult.Partial(ByteRange(start, end))
    }
  }
}
