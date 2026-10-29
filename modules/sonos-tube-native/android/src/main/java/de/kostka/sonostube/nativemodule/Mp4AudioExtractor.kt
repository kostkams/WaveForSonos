package de.kostka.sonostube.nativemodule

import android.util.Log
import java.io.BufferedInputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/** The MP4 data is malformed / unsupported (as opposed to a network error). */
class Mp4FormatException(message: String, cause: Throwable? = null) : IOException(message, cause)

/**
 * Audio samples of a progressive (non-fragmented) MP4, in decode order.
 * [offsets] are absolute file offsets, [times] decode times in [timescale] ticks.
 */
class AudioSampleTable(
  val aac: AacConfig,
  val timescale: Long,
  val offsets: LongArray,
  val sizes: IntArray,
  val times: LongArray
) {
  val count get() = sizes.size

  /** Index of the first sample starting at or after [seconds] ([count] if there is none). */
  fun indexAt(seconds: Double): Int {
    if (seconds <= 0 || count == 0) return 0
    val ticks = (seconds * timescale).toLong()
    var lo = 0
    var hi = count
    while (lo < hi) {
      val mid = (lo + hi) ushr 1
      if (times[mid] < ticks) lo = mid + 1 else hi = mid
    }
    return lo
  }
}

/**
 * Extracts the AAC track of a progressive MP4 with audio + video (YouTube itag 18) and
 * writes it as ADTS. Used when YouTube offers no audio-only stream (e.g. "made for kids").
 */
object Mp4Audio {
  private const val PROBE_SIZE = 64 * 1024
  private const val MAX_MOOV_SIZE = 64L * 1024 * 1024
  private const val MAX_SAMPLES = 20_000_000
  /** Gaps larger than this between two audio samples are bridged by reopening, not by reading. */
  private const val REOPEN_GAP = 4L * 1024 * 1024

  /**
   * Walks the top-level boxes with range reads and returns the complete `moov` box
   * (header included). [read] returns the bytes [start, endInclusive] (may be shorter at EOF).
   * [total] is the file length, or <= 0 if unknown.
   */
  fun findMoov(total: Long, read: (Long, Long) -> ByteArray): ByteArray {
    var bufStart = 0L
    var buf = read(0, (if (total > 0) minOf(total, PROBE_SIZE.toLong()) else PROBE_SIZE.toLong()) - 1)
    var p = 0L
    repeat(256) {
      if (total > 0 && p + 8 > total) throw Mp4FormatException("moov box not found")
      if (p < bufStart || p + 16 > bufStart + buf.size) {
        val end = if (total > 0) minOf(total - 1, p + 15) else p + 15
        buf = read(p, end)
        bufStart = p
      }
      val o = (p - bufStart).toInt()
      if (o + 8 > buf.size) throw Mp4FormatException("moov box not found (EOF at $p)")
      var size = Fmp4.u32(buf, o)
      val type = Fmp4.type(buf, o + 4)
      if (size == 1L) {
        if (o + 16 > buf.size) throw Mp4FormatException("truncated box header at $p")
        size = Fmp4.u64(buf, o + 8)
      } else if (size == 0L) {
        // Box extends to the end of the file.
        if (type != "moov" || total <= 0) throw Mp4FormatException("moov box not found")
        size = total - p
      }
      if (size < 8) throw Mp4FormatException("bad box size $size at $p")
      if (type == "moov") {
        if (size > MAX_MOOV_SIZE) throw Mp4FormatException("moov too large: $size")
        if (total > 0 && p + size > total) throw Mp4FormatException("moov box truncated")
        if (p + size <= bufStart + buf.size) return buf.copyOfRange(o, o + size.toInt())
        val moov = read(p, p + size - 1)
        if (moov.size.toLong() != size) throw Mp4FormatException("moov box truncated")
        return moov
      }
      p += size
    }
    throw Mp4FormatException("moov box not found (too many boxes)")
  }

  /** Parses the sample table of the first AAC sound track of [moov] (a complete moov box). */
  fun parseSampleTable(moov: ByteArray): AudioSampleTable = try {
    parseUnchecked(moov)
  } catch (e: IndexOutOfBoundsException) {
    throw Mp4FormatException("moov malformed", e)
  } catch (e: IllegalArgumentException) {
    throw Mp4FormatException("moov malformed: ${e.message}", e)
  }

  private fun parseUnchecked(data: ByteArray): AudioSampleTable {
    val top = Fmp4.children(data, 0, data.size)
    val moov = top.firstOrNull { it.type == "moov" } ?: throw Mp4FormatException("not a moov box")
    if (moov.truncated) throw Mp4FormatException("moov box truncated")
    for (trak in Fmp4.children(data, moov.payload, moov.end).filter { it.type == "trak" }) {
      val mdia = Fmp4.child(data, trak, "mdia") ?: continue
      val hdlr = Fmp4.child(data, mdia, "hdlr") ?: continue
      if (Fmp4.type(data, hdlr.payload + 8) != "soun") continue
      val stbl = Fmp4.child(data, mdia, "minf")?.let { Fmp4.child(data, it, "stbl") } ?: continue
      val aac = audioConfig(data, stbl) ?: continue
      var timescale = Fmp4.child(data, mdia, "mdhd")?.let { mdhd ->
        val version = data[mdhd.payload].toInt() and 0xFF
        if (version == 1) Fmp4.u32(data, mdhd.payload + 4 + 16) else Fmp4.u32(data, mdhd.payload + 4 + 8)
      } ?: 0L
      if (timescale <= 0) timescale = aac.sampleRate.toLong()
      return buildTable(data, stbl, aac, timescale)
    }
    throw Mp4FormatException("No AAC sound track found")
  }

  private fun audioConfig(data: ByteArray, stbl: Fmp4.Box): AacConfig? {
    val stsd = Fmp4.child(data, stbl, "stsd") ?: return null
    // stsd: fullbox(4) + entry_count(4), then sample entries
    val mp4a = Fmp4.children(data, stsd.payload + 8, stsd.end).firstOrNull { it.type == "mp4a" } ?: return null
    // AudioSampleEntry is 28 bytes; QuickTime sound description v1 / v2 add 16 / 36 bytes.
    val extra = when (Fmp4.u16(data, mp4a.payload + 8)) {
      1 -> 16
      2 -> 36
      else -> 0
    }
    val esds = Fmp4.children(data, mp4a.payload + 28 + extra, mp4a.end).firstOrNull { it.type == "esds" } ?: return null
    return Fmp4.parseEsds(data, esds)
  }

  private fun requireBox(data: ByteArray, stbl: Fmp4.Box, type: String): Fmp4.Box {
    val box = Fmp4.child(data, stbl, type) ?: throw Mp4FormatException("$type box missing")
    if (box.truncated) throw Mp4FormatException("$type box truncated")
    return box
  }

  /** Entry count at payload+4 of a full box, checked against the box size. */
  private fun entryCount(data: ByteArray, box: Fmp4.Box, entrySize: Int, headerSize: Int = 8): Int {
    val n = Fmp4.u32(data, box.payload + headerSize - 4)
    if (n < 0 || n > MAX_SAMPLES || box.payload + headerSize + n * entrySize > box.end) {
      throw Mp4FormatException("${box.type}: bad entry count $n")
    }
    return n.toInt()
  }

  private fun buildTable(data: ByteArray, stbl: Fmp4.Box, aac: AacConfig, timescale: Long): AudioSampleTable {
    // stsz: fullbox(4) sample_size(4) sample_count(4) [entry_size(4) * count]
    val stsz = requireBox(data, stbl, "stsz")
    val fixedSize = Fmp4.u32(data, stsz.payload + 4)
    val sizes: IntArray
    if (fixedSize != 0L) {
      val n = Fmp4.u32(data, stsz.payload + 8)
      if (n > MAX_SAMPLES) throw Mp4FormatException("stsz: bad sample count $n")
      sizes = IntArray(n.toInt()) { fixedSize.toInt() }
    } else {
      val n = entryCount(data, stsz, 4, headerSize = 12)
      sizes = IntArray(n) { Fmp4.u32(data, stsz.payload + 12 + it * 4).toInt() }
    }
    val count = sizes.size
    if (count == 0) throw Mp4FormatException("audio track has no samples")

    // stts: (sample_count, sample_delta) runs
    val stts = requireBox(data, stbl, "stts")
    val times = LongArray(count)
    run {
      val runs = entryCount(data, stts, 8)
      var s = 0
      var t = 0L
      var delta = 1024L
      for (r in 0 until runs) {
        val n = Fmp4.u32(data, stts.payload + 8 + r * 8)
        delta = Fmp4.u32(data, stts.payload + 12 + r * 8)
        var k = 0L
        while (k < n && s < count) { times[s++] = t; t += delta; k++ }
        if (s >= count) break
      }
      // Fewer stts entries than samples: continue with the last delta.
      while (s < count) { times[s++] = t; t += delta }
    }

    // stco / co64: chunk offsets
    val stco = Fmp4.child(data, stbl, "stco")
    val co64 = Fmp4.child(data, stbl, "co64")
    val chunkOffsets: LongArray = when {
      stco != null -> {
        if (stco.truncated) throw Mp4FormatException("stco box truncated")
        val n = entryCount(data, stco, 4)
        LongArray(n) { Fmp4.u32(data, stco.payload + 8 + it * 4) }
      }
      co64 != null -> {
        if (co64.truncated) throw Mp4FormatException("co64 box truncated")
        val n = entryCount(data, co64, 8)
        LongArray(n) { Fmp4.u64(data, co64.payload + 8 + it * 8) }
      }
      else -> throw Mp4FormatException("stco/co64 box missing")
    }

    // stsc: (first_chunk, samples_per_chunk, sample_description_index) runs, chunks 1-based
    val stsc = requireBox(data, stbl, "stsc")
    val runs = entryCount(data, stsc, 12)
    val offsets = LongArray(count)
    var s = 0
    for (r in 0 until runs) {
      val first = Fmp4.u32(data, stsc.payload + 8 + r * 12) - 1
      val perChunk = Fmp4.u32(data, stsc.payload + 12 + r * 12)
      val nextFirst = if (r + 1 < runs) Fmp4.u32(data, stsc.payload + 8 + (r + 1) * 12) - 1 else chunkOffsets.size.toLong()
      if (first < 0 || perChunk <= 0) throw Mp4FormatException("stsc: bad entry $r")
      var chunk = first
      while (chunk < minOf(nextFirst, chunkOffsets.size.toLong()) && s < count) {
        var off = chunkOffsets[chunk.toInt()]
        var k = 0L
        while (k < perChunk && s < count) {
          offsets[s] = off
          off += sizes[s]
          s++
          k++
        }
        chunk++
      }
    }
    if (s == 0) throw Mp4FormatException("no audio sample offsets")
    if (s < count) {
      // Inconsistent tables: keep what can be located.
      return AudioSampleTable(aac, timescale, offsets.copyOf(s), sizes.copyOf(s), times.copyOf(s))
    }
    return AudioSampleTable(aac, timescale, offsets, sizes, times)
  }

  /**
   * Writes the samples [fromIndex] … end of [table] as ADTS frames to [out].
   * [open] returns a sequential stream over the file range [start, endInclusive]; it is
   * called again when a sample lies before the current position or far after it.
   */
  fun writeAdts(table: AudioSampleTable, fromIndex: Int, open: (Long, Long) -> InputStream, out: OutputStream) {
    if (fromIndex >= table.count) return
    var endExclusive = 0L
    for (i in fromIndex until table.count) endExclusive = maxOf(endExclusive, table.offsets[i] + table.sizes[i])
    val aac = table.aac
    var input: InputStream? = null
    var pos = 0L
    var buf = ByteArray(4096)
    try {
      for (i in fromIndex until table.count) {
        val off = table.offsets[i]
        val size = table.sizes[i]
        // ADTS frame length has 13 bits; such samples can't be real AAC frames anyway.
        if (size <= 0 || size + 7 >= (1 shl 13)) continue
        val current = input
        if (current == null || off < pos || off - pos > REOPEN_GAP) {
          current?.close()
          input = BufferedInputStream(open(off, endExclusive - 1), 64 * 1024)
          pos = off
        } else if (off > pos) {
          skipFully(current, off - pos)
          pos = off
        }
        if (size > buf.size) buf = ByteArray(size)
        readFully(input!!, buf, size)
        pos += size
        out.write(Adts.header(aac.objectType, aac.frequencyIndex, aac.channelConfig, size))
        out.write(buf, 0, size)
        if (i % 64 == 63) out.flush()
      }
      out.flush()
    } finally {
      try { input?.close() } catch (_: IOException) {}
    }
  }

  private fun readFully(input: InputStream, buf: ByteArray, len: Int) {
    var n = 0
    while (n < len) {
      val r = input.read(buf, n, len - n)
      if (r < 0) throw EOFException("stream ended inside an audio sample")
      n += r
    }
  }

  private fun skipFully(input: InputStream, count: Long) {
    var remaining = count
    val tmp = ByteArray(8192)
    while (remaining > 0) {
      val skipped = input.skip(remaining)
      if (skipped > 0) { remaining -= skipped; continue }
      val r = input.read(tmp, 0, minOf(tmp.size.toLong(), remaining).toInt())
      if (r < 0) throw EOFException()
      remaining -= r
    }
  }
}

/** Sample tables of muxed YouTube streams, cached per video (Sonos re-requests on seek/retry). */
object MuxedAudio {
  private const val TAG = "SonosTubeMuxed"
  private const val CACHE_SIZE = 8

  private class Entry(val itag: Int, val table: AudioSampleTable)

  private val cache = object : LinkedHashMap<String, Entry>(16, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Entry>?) = size > CACHE_SIZE
  }
  private val locks = java.util.concurrent.ConcurrentHashMap<String, Any>()

  /** Parsed audio sample table of [audio] (a muxed stream), fetched with range reads. */
  fun sampleTable(audio: ResolvedAudio): AudioSampleTable {
    synchronized(cache) { cache[audio.videoId]?.takeIf { it.itag == audio.itag }?.let { return it.table } }
    synchronized(locks.getOrPut(audio.videoId) { Any() }) {
      synchronized(cache) { cache[audio.videoId]?.takeIf { it.itag == audio.itag }?.let { return it.table } }
      val started = System.currentTimeMillis()
      val moov = Mp4Audio.findMoov(audio.contentLength) { start, end -> GoogleVideo.readRange(audio.videoId, start, end) }
      val table = Mp4Audio.parseSampleTable(moov)
      Log.i(TAG, "${audio.videoId}: ${table.count} audio samples, moov ${moov.size} B, ${System.currentTimeMillis() - started} ms")
      synchronized(cache) { cache[audio.videoId] = Entry(audio.itag, table) }
      return table
    }
  }

  /** Streams the audio of [videoId] from [startSec] on as ADTS. */
  fun streamAdts(videoId: String, table: AudioSampleTable, startSec: Double, out: OutputStream) {
    Mp4Audio.writeAdts(table, table.indexAt(startSec), { start, end -> UpstreamInputStream(videoId, start, end) }, out)
  }
}
