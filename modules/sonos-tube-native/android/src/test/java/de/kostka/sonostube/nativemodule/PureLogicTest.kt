package de.kostka.sonostube.nativemodule

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.schabi.newpipe.extractor.Page
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class PureLogicTest {

  @Test
  fun adtsHeader_aacLc_44100_stereo() {
    val h = Adts.header(objectType = 2, frequencyIndex = 4, channelConfig = 2, payloadLength = 100)
    // frame length 107 = 0b000_0000_0110_1011
    assertArrayEquals(
      byteArrayOf(0xFF.toByte(), 0xF1.toByte(), 0x50, 0x80.toByte(), 0x0D, 0x7F, 0xFC.toByte()),
      h
    )
  }

  @Test
  fun audioSpecificConfig_lc_44100_stereo() {
    // 0x12 0x10 = 00010 0100 0010 000
    val cfg = Adts.parseAudioSpecificConfig(byteArrayOf(0x12, 0x10))
    assertEquals(2, cfg.objectType)
    assertEquals(4, cfg.frequencyIndex)
    assertEquals(44100, cfg.sampleRate)
    assertEquals(2, cfg.channelConfig)
  }

  @Test
  fun base64_roundTrip() {
    for (len in 0..20) {
      val data = ByteArray(len) { (it * 37 + 5).toByte() }
      assertArrayEquals(data, Base64Url.decode(Base64Url.encode(data)))
    }
  }

  @Test
  fun pageToken_roundTrip() {
    val page = Page("https://example.com/x?a=1", "id42", listOf("a", "b"), mapOf("c" to "d"), byteArrayOf(1, 2, 3, 0, -1))
    val token = PageToken.encode(page)!!
    assertTrue(token.matches(Regex("[A-Za-z0-9_-]+")))
    val back = PageToken.decode(token)!!
    assertEquals(page.url, back.url)
    assertEquals(page.id, back.id)
    assertEquals(page.ids, back.ids)
    assertEquals(page.cookies, back.cookies)
    assertArrayEquals(page.body, back.body)

    val urlOnly = PageToken.decode(PageToken.encode(Page("https://u"))!!)!!
    assertEquals("https://u", urlOnly.url)
    assertNull(urlOnly.body)
    assertNull(PageToken.encode(null))
    assertNull(PageToken.decode(null))
  }

  @Test
  fun rangeParsing() {
    assertEquals(RangeResult.Full, HttpRange.parse(null, 1000))
    assertEquals(RangeResult.Partial(ByteRange(0, 999)), HttpRange.parse("bytes=0-", 1000))
    assertEquals(RangeResult.Partial(ByteRange(100, 199)), HttpRange.parse("bytes=100-199", 1000))
    assertEquals(RangeResult.Partial(ByteRange(900, 999)), HttpRange.parse("bytes=-100", 1000))
    assertEquals(RangeResult.Partial(ByteRange(500, 999)), HttpRange.parse("bytes=500-5000", 1000))
    assertEquals(RangeResult.Unsatisfiable, HttpRange.parse("bytes=1000-", 1000))
    assertEquals(RangeResult.Partial(ByteRange(0, 9)), HttpRange.parse("bytes=0-9,20-29", 1000))
  }

  // region synthetic fMP4

  private fun box(type: String, vararg payload: ByteArray): ByteArray {
    val body = payload.fold(ByteArray(0)) { acc, b -> acc + b }
    return u32(8 + body.size) + type.toByteArray(Charsets.ISO_8859_1) + body
  }

  private fun u32(v: Int) = byteArrayOf((v ushr 24).toByte(), (v ushr 16).toByte(), (v ushr 8).toByte(), v.toByte())
  private fun u16(v: Int) = byteArrayOf((v ushr 8).toByte(), v.toByte())
  private fun zeros(n: Int) = ByteArray(n)

  private fun initSegment(): ByteArray {
    val asc = byteArrayOf(0x12, 0x10)
    val decSpecific = byteArrayOf(0x05, asc.size.toByte()) + asc
    val decConfig = byteArrayOf(0x04, (13 + decSpecific.size).toByte(), 0x40, 0x15) + zeros(11) + decSpecific
    val esDesc = byteArrayOf(0x03, (3 + decConfig.size).toByte(), 0, 1, 0) + decConfig
    val esds = box("esds", zeros(4), esDesc)
    val mp4a = box("mp4a", zeros(6), u16(1), zeros(8), u16(2), u16(16), zeros(4), u32(44100 shl 16), esds)
    val stsd = box("stsd", zeros(4), u32(1), mp4a)
    val stbl = box("stbl", stsd)
    val minf = box("minf", stbl)
    val hdlr = box("hdlr", zeros(4), zeros(4), "soun".toByteArray(), zeros(12))
    val mdhd = box("mdhd", zeros(4), zeros(8), u32(44100), u32(0), zeros(4))
    val mdia = box("mdia", mdhd, hdlr, minf)
    val trak = box("trak", mdia)
    val trex = box("trex", zeros(4), u32(1), u32(1), u32(1024), u32(0), u32(0))
    val mvex = box("mvex", trex)
    val moov = box("moov", trak, mvex)
    return box("ftyp", "dash".toByteArray(), zeros(4)) + moov
  }

  private fun fragment(baseTime: Int, samples: List<ByteArray>): ByteArray {
    val tfhd = box("tfhd", u32(0), u32(1))
    val tfdt = box("tfdt", u32(0), u32(baseTime))
    // flags: data-offset present (0x1) + sample-size present (0x200)
    val trunNoOffset = { off: Int ->
      box("trun", u32(0x000201), u32(samples.size), u32(off), *samples.map { u32(it.size) }.toTypedArray())
    }
    val trafLen = { off: Int -> box("traf", tfhd, tfdt, trunNoOffset(off)) }
    val moofSize = box("moof", trafLen(0)).size
    val moof = box("moof", trafLen(moofSize + 8))
    val mdat = box("mdat", *samples.toTypedArray())
    return moof + mdat
  }

  @Test
  fun remuxSyntheticFragment() {
    val init = initSegment()
    val header = Fmp4.parseHeader(init)
    assertEquals(44100L, header.init.timescale)
    assertEquals(2, header.init.aac.channelConfig)
    assertEquals(1024L, header.init.defaultSampleDuration)

    val samples = listOf(ByteArray(10) { 1 }, ByteArray(20) { 2 }, ByteArray(30) { 3 })
    val data = fragment(0, samples) + fragment(3072, samples)
    val out = ByteArrayOutputStream()
    Fmp4.remuxToAdts(header.init, ByteArrayInputStream(data), out)
    assertEquals(2 * (60 + 3 * 7), out.size())
    val bytes = out.toByteArray()
    assertEquals(0xFF.toByte(), bytes[0])
    assertEquals(0xF1.toByte(), bytes[1])

    // Skipping the first 2 samples (2 * 1024 ticks) leaves 1 + 3 samples.
    val skipped = ByteArrayOutputStream()
    Fmp4.remuxToAdts(header.init, ByteArrayInputStream(data), skipped, skipUntilTicks = 2048)
    assertEquals((30 + 7) + (60 + 3 * 7), skipped.size())
  }

  @Test
  fun sidxLocate() {
    val sidx = SidxInfo(1000, 0, 500, listOf(SidxReference(100, 10_000), SidxReference(200, 10_000), SidxReference(300, 10_000)))
    assertEquals(500L to 0L, sidx.locate(0))
    assertEquals(600L to 10_000L, sidx.locate(15_000))
    assertEquals(800L to 20_000L, sidx.locate(29_999))
  }

  // endregion
}
