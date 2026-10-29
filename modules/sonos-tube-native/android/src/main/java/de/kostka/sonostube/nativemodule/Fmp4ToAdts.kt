package de.kostka.sonostube.nativemodule

import java.io.DataInputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/** AAC configuration taken from the esds AudioSpecificConfig. */
data class AacConfig(val objectType: Int, val frequencyIndex: Int, val sampleRate: Int, val channelConfig: Int)

/** Information extracted from the fMP4 init segment (ftyp + moov). */
data class Mp4InitInfo(
  val timescale: Long,
  val aac: AacConfig,
  val defaultSampleDuration: Long,
  val defaultSampleSize: Long
)

data class SidxReference(val size: Long, val duration: Long)

/** Parsed `sidx` box. [firstFragmentOffset] is the absolute file offset of the first fragment. */
data class SidxInfo(
  val timescale: Long,
  val earliestPresentationTime: Long,
  val firstFragmentOffset: Long,
  val references: List<SidxReference>
) {
  /** Returns (fileOffset, fragmentStartTime) of the fragment that contains [timeTicks]. */
  fun locate(timeTicks: Long): Pair<Long, Long> {
    var offset = firstFragmentOffset
    var t = earliestPresentationTime
    for (ref in references) {
      if (t + ref.duration > timeTicks) return offset to t
      t += ref.duration
      offset += ref.size
    }
    return offset to t
  }
}

/** Layout of the top-level boxes in the stream prefix. */
data class Mp4Header(val init: Mp4InitInfo, val sidx: SidxInfo?, val firstFragmentOffset: Long)

object Adts {
  private val SAMPLE_RATES = intArrayOf(96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350)

  fun frequencyIndexFor(sampleRate: Int): Int {
    val i = SAMPLE_RATES.indexOf(sampleRate)
    return if (i >= 0) i else 4 // default 44.1 kHz
  }

  fun sampleRateFor(index: Int): Int = SAMPLE_RATES.getOrElse(index) { 44100 }

  /**
   * Builds a 7-byte ADTS header (no CRC) for a raw AAC frame of [payloadLength] bytes.
   * [objectType] is the MPEG-4 audio object type (2 = AAC-LC); ADTS profile = objectType - 1.
   */
  fun header(objectType: Int, frequencyIndex: Int, channelConfig: Int, payloadLength: Int): ByteArray {
    val profile = (if (objectType in 1..4) objectType else 2) - 1
    val frameLength = payloadLength + 7
    require(frameLength < (1 shl 13)) { "AAC frame too large for ADTS: $frameLength" }
    val h = ByteArray(7)
    h[0] = 0xFF.toByte()
    h[1] = 0xF1.toByte() // MPEG-4, layer 0, protection absent
    h[2] = ((profile shl 6) or ((frequencyIndex and 0x0F) shl 2) or ((channelConfig shr 2) and 0x01)).toByte()
    h[3] = (((channelConfig and 0x03) shl 6) or ((frameLength shr 11) and 0x03)).toByte()
    h[4] = ((frameLength shr 3) and 0xFF).toByte()
    h[5] = (((frameLength and 0x07) shl 5) or 0x1F).toByte()
    h[6] = 0xFC.toByte()
    return h
  }

  /** Parses an MPEG-4 AudioSpecificConfig. */
  fun parseAudioSpecificConfig(asc: ByteArray): AacConfig {
    val bits = BitReader(asc)
    var objectType = bits.read(5)
    if (objectType == 31) objectType = 32 + bits.read(6)
    var freqIndex = bits.read(4)
    val sampleRate: Int
    if (freqIndex == 15) {
      sampleRate = bits.read(24)
      freqIndex = frequencyIndexFor(sampleRate)
    } else {
      sampleRate = sampleRateFor(freqIndex)
    }
    val channelConfig = bits.read(4)
    // SBR / PS (HE-AAC): ADTS can only carry the core AAC-LC config.
    if (objectType == 5 || objectType == 29) {
      var extIndex = bits.read(4)
      if (extIndex == 15) bits.read(24)
      var core = bits.read(5)
      if (core == 31) core = 32 + bits.read(6)
      objectType = core
    }
    return AacConfig(objectType, freqIndex, sampleRate, channelConfig)
  }

  private class BitReader(private val data: ByteArray) {
    private var pos = 0
    fun read(n: Int): Int {
      var v = 0
      repeat(n) {
        val byte = if (pos / 8 < data.size) data[pos / 8].toInt() and 0xFF else 0
        val bit = (byte shr (7 - pos % 8)) and 1
        v = (v shl 1) or bit
        pos++
      }
      return v
    }
  }
}

/** Minimal ISO-BMFF parsing for YouTube's DASH audio (itag 140). */
object Fmp4 {
  internal fun u32(b: ByteArray, o: Int): Long =
    ((b[o].toLong() and 0xFF) shl 24) or ((b[o + 1].toLong() and 0xFF) shl 16) or
      ((b[o + 2].toLong() and 0xFF) shl 8) or (b[o + 3].toLong() and 0xFF)

  internal fun u64(b: ByteArray, o: Int): Long = (u32(b, o) shl 32) or u32(b, o + 4)
  internal fun u16(b: ByteArray, o: Int): Int = ((b[o].toInt() and 0xFF) shl 8) or (b[o + 1].toInt() and 0xFF)
  internal fun type(b: ByteArray, o: Int): String = String(b, o, 4, Charsets.ISO_8859_1)

  /**
   * A box inside [data]: [start] = header start, [payload] = first payload byte, [end] exclusive
   * (clamped to the parsed range). [truncated] = the declared size extends beyond that range.
   */
  data class Box(val type: String, val start: Int, val payload: Int, val end: Int, val truncated: Boolean = false)

  fun children(data: ByteArray, from: Int, to: Int): List<Box> {
    val boxes = ArrayList<Box>()
    var p = from
    while (p + 8 <= to) {
      var size = u32(data, p)
      val t = type(data, p + 4)
      var header = 8
      if (size == 1L) {
        if (p + 16 > to) break
        size = u64(data, p + 8)
        header = 16
      } else if (size == 0L) {
        size = (to - p).toLong()
      }
      if (size < header) break
      val end = p.toLong() + size
      boxes.add(Box(t, p, p + header, minOf(end, to.toLong()).toInt(), truncated = end > to))
      if (end > to) break
      p = end.toInt()
    }
    return boxes
  }

  internal fun child(data: ByteArray, parent: Box, type: String) =
    children(data, parent.payload, parent.end).firstOrNull { it.type == type }

  /**
   * Parses the stream prefix (must contain ftyp + moov, ideally sidx).
   * [prefixFileOffset] is the absolute offset of data[0] (normally 0).
   */
  fun parseHeader(data: ByteArray, prefixFileOffset: Long = 0): Mp4Header = try {
    parseHeaderUnchecked(data, prefixFileOffset)
  } catch (e: IndexOutOfBoundsException) {
    // Malformed / short prefix: report as I/O so the caller retries with a bigger prefix.
    throw IOException("mp4 header malformed or truncated", e)
  }

  private fun parseHeaderUnchecked(data: ByteArray, prefixFileOffset: Long): Mp4Header {
    val top = children(data, 0, data.size)
    val moov = top.firstOrNull { it.type == "moov" } ?: throw IOException("moov box not found")
    if (moov.truncated) throw IOException("moov box truncated")
    val init = parseMoov(data, moov)
    val sidxBox = top.firstOrNull { it.type == "sidx" }
    // A cut-off sidx would give wrong seek offsets: let the caller fetch a bigger prefix.
    if (sidxBox != null && sidxBox.truncated) throw IOException("sidx box truncated")
    val sidx = sidxBox?.let { parseSidx(data, it, prefixFileOffset) }
    val firstFragment = sidx?.firstFragmentOffset
      ?: top.firstOrNull { it.type == "moof" }?.let { prefixFileOffset + it.start }
      ?: (prefixFileOffset + maxOf(moov.end, sidxBox?.end ?: 0))
    return Mp4Header(init, sidx, firstFragment)
  }

  private fun parseMoov(data: ByteArray, moov: Box): Mp4InitInfo {
    var timescale = 0L
    var aac: AacConfig? = null
    var defDuration = 0L
    var defSize = 0L
    for (trak in children(data, moov.payload, moov.end).filter { it.type == "trak" }) {
      val mdia = child(data, trak, "mdia") ?: continue
      val hdlr = child(data, mdia, "hdlr")
      if (hdlr != null && type(data, hdlr.payload + 8) != "soun") continue
      child(data, mdia, "mdhd")?.let { mdhd ->
        val version = data[mdhd.payload].toInt() and 0xFF
        timescale = if (version == 1) u32(data, mdhd.payload + 4 + 16) else u32(data, mdhd.payload + 4 + 8)
      }
      val stsd = child(data, mdia, "minf")?.let { child(data, it, "stbl") }?.let { child(data, it, "stsd") } ?: continue
      // stsd: fullbox(4) + entry_count(4), then sample entries
      val entries = children(data, stsd.payload + 8, stsd.end)
      val mp4a = entries.firstOrNull { it.type == "mp4a" } ?: continue
      // AudioSampleEntry: 6 reserved + 2 dref idx + 8 reserved + 2 ch + 2 size + 4 + 4 rate = 28
      val esds = children(data, mp4a.payload + 28, mp4a.end).firstOrNull { it.type == "esds" } ?: continue
      aac = parseEsds(data, esds)
    }
    val mvex = child(data, moov, "mvex")
    val trex = mvex?.let { child(data, it, "trex") }
    if (trex != null) {
      // fullbox(4) track_ID(4) default_sample_description_index(4) duration(4) size(4) flags(4)
      defDuration = u32(data, trex.payload + 12)
      defSize = u32(data, trex.payload + 16)
    }
    if (aac == null) throw IOException("No AAC (mp4a/esds) track found")
    if (timescale <= 0) timescale = aac.sampleRate.toLong()
    return Mp4InitInfo(timescale, aac, defDuration, defSize)
  }

  internal fun parseEsds(data: ByteArray, esds: Box): AacConfig {
    var p = esds.payload + 4 // fullbox
    val end = esds.end
    fun readLen(): Int {
      var len = 0
      for (i in 0 until 4) {
        val b = data[p++].toInt() and 0xFF
        len = (len shl 7) or (b and 0x7F)
        if (b and 0x80 == 0) break
      }
      return len
    }
    while (p < end) {
      val tag = data[p++].toInt() and 0xFF
      val len = readLen()
      when (tag) {
        0x03 -> { // ES_Descriptor
          p += 2
          val flags = data[p++].toInt() and 0xFF
          if (flags and 0x80 != 0) p += 2
          if (flags and 0x40 != 0) p += 1 + (data[p].toInt() and 0xFF)
          if (flags and 0x20 != 0) p += 2
        }
        0x04 -> p += 13 // DecoderConfigDescriptor header; children follow
        0x05 -> return Adts.parseAudioSpecificConfig(data.copyOfRange(p, minOf(p + len, end)))
        else -> p += len
      }
    }
    throw IOException("AudioSpecificConfig not found in esds")
  }

  private fun parseSidx(data: ByteArray, box: Box, prefixFileOffset: Long): SidxInfo {
    var p = box.payload
    val version = data[p].toInt() and 0xFF
    p += 4 + 4 // fullbox + reference_ID
    val timescale = u32(data, p); p += 4
    val ept: Long
    val firstOffset: Long
    if (version == 0) {
      ept = u32(data, p); firstOffset = u32(data, p + 4); p += 8
    } else {
      ept = u64(data, p); firstOffset = u64(data, p + 8); p += 16
    }
    p += 2 // reserved
    val count = u16(data, p); p += 2
    val refs = ArrayList<SidxReference>(count)
    repeat(count) {
      if (p + 12 > box.end) return@repeat
      val size = u32(data, p) and 0x7FFFFFFF
      val duration = u32(data, p + 4)
      refs.add(SidxReference(size, duration))
      p += 12
    }
    return SidxInfo(timescale, ept, prefixFileOffset + box.end + firstOffset, refs)
  }

  /**
   * Reads moof/mdat pairs from [input] (positioned at a fragment boundary) and writes
   * ADTS frames to [out]. Samples whose end time is <= [skipUntilTicks] are dropped.
   */
  fun remuxToAdts(init: Mp4InitInfo, input: InputStream, out: OutputStream, skipUntilTicks: Long = 0) {
    val din = DataInputStream(input)
    val aac = init.aac
    var pendingSizes: LongArray? = null
    var pendingDurations: LongArray? = null
    var pendingBaseTime = -1L
    var pendingDataOffset = 0L
    var moofSize = 0L
    var nextDecodeTime = 0L
    val headerBuf = ByteArray(16)

    while (true) {
      try {
        din.readFully(headerBuf, 0, 8)
      } catch (e: EOFException) {
        return
      }
      var size = u32(headerBuf, 0)
      val t = type(headerBuf, 4)
      var headerLen = 8
      if (size == 1L) {
        din.readFully(headerBuf, 8, 8)
        size = u64(headerBuf, 8)
        headerLen = 16
      }
      val payloadLen = if (size == 0L) Long.MAX_VALUE else size - headerLen
      when (t) {
        "moof" -> {
          if (payloadLen > 4 * 1024 * 1024) throw IOException("moof too large")
          val moof = ByteArray(payloadLen.toInt())
          din.readFully(moof)
          moofSize = size
          val frag = parseMoof(moof, init)
          pendingSizes = frag.sizes
          pendingDurations = frag.durations
          pendingBaseTime = frag.baseDecodeTime
          pendingDataOffset = frag.dataOffset
        }
        "mdat" -> {
          val sizes = pendingSizes
          if (sizes == null) {
            skipFully(din, payloadLen)
            continue
          }
          var consumed = 0L
          // data_offset is relative to the moof start; samples normally begin right after the mdat header.
          if (pendingDataOffset > 0) {
            val lead = pendingDataOffset - (moofSize + headerLen)
            if (lead > 0) { skipFully(din, lead); consumed += lead }
          }
          var time = if (pendingBaseTime >= 0) pendingBaseTime else nextDecodeTime
          val durations = pendingDurations!!
          var sampleBuf = ByteArray(4096)
          for (i in sizes.indices) {
            val s = sizes[i].toInt()
            if (consumed + s > payloadLen) break
            val dur = durations[i]
            if (time + dur <= skipUntilTicks) {
              skipFully(din, s.toLong())
            } else {
              if (s > sampleBuf.size) sampleBuf = ByteArray(s)
              din.readFully(sampleBuf, 0, s)
              out.write(Adts.header(aac.objectType, aac.frequencyIndex, aac.channelConfig, s))
              out.write(sampleBuf, 0, s)
            }
            consumed += s
            time += dur
          }
          nextDecodeTime = time
          if (payloadLen != Long.MAX_VALUE && consumed < payloadLen) skipFully(din, payloadLen - consumed)
          out.flush()
          pendingSizes = null
          pendingDurations = null
          if (payloadLen == Long.MAX_VALUE) return
        }
        else -> {
          if (payloadLen == Long.MAX_VALUE) return
          skipFully(din, payloadLen)
        }
      }
    }
  }

  private class Fragment(val sizes: LongArray, val durations: LongArray, val baseDecodeTime: Long, val dataOffset: Long)

  private fun parseMoof(moof: ByteArray, init: Mp4InitInfo): Fragment {
    val sizes = ArrayList<Long>()
    val durations = ArrayList<Long>()
    var baseTime = -1L
    var dataOffset = 0L
    for (traf in children(moof, 0, moof.size).filter { it.type == "traf" }) {
      var defDuration = init.defaultSampleDuration
      var defSize = init.defaultSampleSize
      val kids = children(moof, traf.payload, traf.end)
      kids.firstOrNull { it.type == "tfhd" }?.let { tfhd ->
        val flags = (u32(moof, tfhd.payload) and 0xFFFFFF).toInt()
        var p = tfhd.payload + 8 // fullbox + track_ID
        if (flags and 0x01 != 0) p += 8 // base_data_offset
        if (flags and 0x02 != 0) p += 4 // sample_description_index
        if (flags and 0x08 != 0) { defDuration = u32(moof, p); p += 4 }
        if (flags and 0x10 != 0) { defSize = u32(moof, p); p += 4 }
      }
      kids.firstOrNull { it.type == "tfdt" }?.let { tfdt ->
        val version = moof[tfdt.payload].toInt() and 0xFF
        baseTime = if (version == 1) u64(moof, tfdt.payload + 4) else u32(moof, tfdt.payload + 4)
      }
      for (trun in kids.filter { it.type == "trun" }) {
        val flags = (u32(moof, trun.payload) and 0xFFFFFF).toInt()
        val count = u32(moof, trun.payload + 4).toInt()
        var p = trun.payload + 8
        if (flags and 0x01 != 0) { if (dataOffset == 0L) dataOffset = u32(moof, p).toInt().toLong(); p += 4 }
        if (flags and 0x04 != 0) p += 4 // first_sample_flags
        for (i in 0 until count) {
          var d = defDuration
          var s = defSize
          if (flags and 0x100 != 0) { d = u32(moof, p); p += 4 }
          if (flags and 0x200 != 0) { s = u32(moof, p); p += 4 }
          if (flags and 0x400 != 0) p += 4
          if (flags and 0x800 != 0) p += 4
          sizes.add(s)
          durations.add(d)
        }
      }
      break // single audio track
    }
    return Fragment(sizes.toLongArray(), durations.toLongArray(), baseTime, dataOffset)
  }

  private fun skipFully(input: DataInputStream, n: Long) {
    var remaining = n
    val buf = ByteArray(8192)
    while (remaining > 0) {
      val skipped = input.skip(remaining)
      if (skipped > 0) { remaining -= skipped; continue }
      val r = input.read(buf, 0, minOf(buf.size.toLong(), remaining).toInt())
      if (r < 0) throw EOFException()
      remaining -= r
    }
  }
}
