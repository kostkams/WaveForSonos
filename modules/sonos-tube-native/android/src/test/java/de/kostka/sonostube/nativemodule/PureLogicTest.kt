package de.kostka.sonostube.nativemodule

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.schabi.newpipe.extractor.Page
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException

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
    // Syntactically invalid specs are ignored (RFC 7233): full body, not 416.
    assertEquals(RangeResult.Full, HttpRange.parse("bytes=5-3", 1000))
    assertEquals(RangeResult.Full, HttpRange.parse("bytes=--5", 1000))
    assertEquals(RangeResult.Full, HttpRange.parse("bytes=+5-", 1000))
    assertEquals(RangeResult.Full, HttpRange.parse("bytes=a-b", 1000))
    assertEquals(RangeResult.Full, HttpRange.parse("bytes=2000-1000", 1000))
    // Valid but unsatisfiable.
    assertEquals(RangeResult.Unsatisfiable, HttpRange.parse("bytes=1000-1500", 1000))
    assertEquals(RangeResult.Unsatisfiable, HttpRange.parse("bytes=-0", 1000))
    assertEquals(RangeResult.Partial(ByteRange(0, 999)), HttpRange.parse("bytes=-5000", 1000))
  }

  @Test
  fun queryParsing_skipsMalformedEscapes() {
    val q = StreamProxyServer.parseQuery("start=12.5&bad=%zz&%zz=1&name=a%20b&flag")
    assertEquals(mapOf("start" to "12.5", "name" to "a b", "flag" to ""), q)
    assertEquals(emptyMap<String, String>(), StreamProxyServer.parseQuery(""))
    assertEquals(emptyMap<String, String>(), StreamProxyServer.parseQuery("x=%"))
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

  private fun sidxBox(): ByteArray = box(
    "sidx",
    u32(0), u32(1), u32(1000), u32(0), u32(0), u16(0), u16(2),
    u32(100), u32(10_000), u32(0),
    u32(200), u32(10_000), u32(0)
  )

  private fun assertIOException(block: () -> Unit) {
    try {
      block()
      fail("expected IOException")
    } catch (e: IOException) {
      // expected
    }
  }

  @Test
  fun parseHeader_withSidx() {
    val init = initSegment()
    val sidx = sidxBox()
    val header = Fmp4.parseHeader(init + sidx)
    assertEquals(1000L, header.sidx!!.timescale)
    assertEquals(2, header.sidx!!.references.size)
    assertEquals((init.size + sidx.size).toLong(), header.firstFragmentOffset)
  }

  @Test
  fun parseHeader_truncatedBoxesThrowIOException() {
    val init = initSegment()
    // moov cut off → IOException (so the proxy retries with a bigger prefix), not IndexOutOfBounds
    assertIOException { Fmp4.parseHeader(init.copyOf(init.size - 10)) }
    val full = init + sidxBox()
    assertIOException { Fmp4.parseHeader(full.copyOf(full.size - 5)) }
    assertTrue(Fmp4.children(full, 0, full.size - 5).last().truncated)
  }

  @Test
  fun sidxLocate() {
    val sidx = SidxInfo(1000, 0, 500, listOf(SidxReference(100, 10_000), SidxReference(200, 10_000), SidxReference(300, 10_000)))
    assertEquals(500L to 0L, sidx.locate(0))
    assertEquals(600L to 10_000L, sidx.locate(15_000))
    assertEquals(800L to 20_000L, sidx.locate(29_999))
  }

  // endregion

  // region synthetic progressive MP4 (audio + video, moov after mdat)

  private val audioSamples = listOf(10, 20, 30, 40, 50).mapIndexed { k, n -> ByteArray(n) { (k * 50 + it).toByte() } }

  /** Builds ftyp + mdat (100 kB video filler interleaved with 2 audio chunks) + moov(video trak, audio trak). */
  private fun progressiveMp4(fixedSampleSize: Boolean = false): Pair<ByteArray, LongArray> {
    val samples = if (fixedSampleSize) List(5) { k -> ByteArray(16) { (k * 50 + it).toByte() } } else audioSamples
    val ftyp = box("ftyp", "isom".toByteArray(), zeros(4))
    val video1 = ByteArray(100_000) { 0x55 }
    val video2 = ByteArray(13) { 0x66 }
    val chunk1 = samples[0] + samples[1]
    val chunk2 = samples[2] + samples[3] + samples[4]
    val mdatBody = video1 + chunk1 + video2 + chunk2
    val mdat = box("mdat", mdatBody)
    val chunk1Offset = ftyp.size + 8 + video1.size
    val chunk2Offset = chunk1Offset + chunk1.size + video2.size

    val asc = byteArrayOf(0x12, 0x10)
    val decSpecific = byteArrayOf(0x05, asc.size.toByte()) + asc
    val decConfig = byteArrayOf(0x04, (13 + decSpecific.size).toByte(), 0x40, 0x15) + zeros(11) + decSpecific
    val esDesc = byteArrayOf(0x03, (3 + decConfig.size).toByte(), 0, 1, 0) + decConfig
    val esds = box("esds", zeros(4), esDesc)
    val mp4a = box("mp4a", zeros(6), u16(1), zeros(8), u16(2), u16(16), zeros(4), u32(44100 shl 16), esds)
    val stsd = box("stsd", zeros(4), u32(1), mp4a)
    val stts = box("stts", zeros(4), u32(2), u32(3), u32(1024), u32(2), u32(2048))
    val stsz = if (fixedSampleSize) box("stsz", zeros(4), u32(16), u32(5))
    else box("stsz", zeros(4), u32(0), u32(5), *samples.map { u32(it.size) }.toTypedArray())
    val stsc = box("stsc", zeros(4), u32(2), u32(1), u32(2), u32(1), u32(2), u32(3), u32(1))
    val stco = box("stco", zeros(4), u32(2), u32(chunk1Offset), u32(chunk2Offset))
    val audioStbl = box("stbl", stsd, stts, stsz, stsc, stco)
    val audioTrak = box(
      "trak",
      box(
        "mdia",
        box("mdhd", zeros(4), zeros(8), u32(44100), u32(0), zeros(4)),
        box("hdlr", zeros(4), zeros(4), "soun".toByteArray(), zeros(12)),
        box("minf", audioStbl)
      )
    )
    // A video track whose tables must be ignored.
    val videoTrak = box(
      "trak",
      box(
        "mdia",
        box("mdhd", zeros(4), zeros(8), u32(90000), u32(0), zeros(4)),
        box("hdlr", zeros(4), zeros(4), "vide".toByteArray(), zeros(12)),
        box("minf", box("stbl", box("stsd", zeros(4), u32(0))))
      )
    )
    val moov = box("moov", box("mvhd", zeros(100)), videoTrak, audioTrak)
    val offsets = longArrayOf(
      chunk1Offset.toLong(), (chunk1Offset + samples[0].size).toLong(),
      chunk2Offset.toLong(), (chunk2Offset + samples[2].size).toLong(), (chunk2Offset + samples[2].size + samples[3].size).toLong()
    )
    return (ftyp + mdat + moov) to offsets
  }

  private fun rangeReader(file: ByteArray): (Long, Long) -> ByteArray =
    { start, end -> file.copyOfRange(start.toInt(), minOf(end.toInt() + 1, file.size)) }

  @Test
  fun progressiveMp4_findsMoovAfterMdatAndParsesAudioTable() {
    val (file, offsets) = progressiveMp4()
    val reads = ArrayList<LongRange>()
    val read = rangeReader(file)
    val moov = Mp4Audio.findMoov(file.size.toLong()) { a, b -> reads.add(a..b); read(a, b) }
    assertEquals("moov", String(moov, 4, 4, Charsets.ISO_8859_1))
    assertTrue("moov is beyond the first probe", reads.size >= 2)

    val table = Mp4Audio.parseSampleTable(moov)
    assertEquals(44100L, table.timescale)
    assertEquals(2, table.aac.objectType)
    assertEquals(2, table.aac.channelConfig)
    assertArrayEquals(offsets, table.offsets)
    assertArrayEquals(intArrayOf(10, 20, 30, 40, 50), table.sizes)
    assertArrayEquals(longArrayOf(0, 1024, 2048, 3072, 5120), table.times)
    assertEquals(0, table.indexAt(0.0))
    assertEquals(3, table.indexAt(3000.0 / 44100))
    assertEquals(5, table.indexAt(1000.0))
    // unknown total length works too
    assertArrayEquals(moov, Mp4Audio.findMoov(-1, read))
  }

  @Test
  fun progressiveMp4_fixedSampleSize() {
    val (file, offsets) = progressiveMp4(fixedSampleSize = true)
    val table = Mp4Audio.parseSampleTable(Mp4Audio.findMoov(file.size.toLong(), rangeReader(file)))
    assertArrayEquals(IntArray(5) { 16 }, table.sizes)
    assertEquals(offsets[2] + 16, table.offsets[3])
  }

  @Test
  fun progressiveMp4_writesAdtsFromStartIndex() {
    val (file, _) = progressiveMp4()
    val table = Mp4Audio.parseSampleTable(Mp4Audio.findMoov(file.size.toLong(), rangeReader(file)))
    val opens = ArrayList<Long>()
    val open = { start: Long, end: Long ->
      opens.add(start)
      ByteArrayInputStream(file.copyOfRange(start.toInt(), end.toInt() + 1)) as java.io.InputStream
    }
    fun expected(from: Int) = (from until 5).fold(ByteArray(0)) { acc, k ->
      acc + Adts.header(2, 4, 2, audioSamples[k].size) + audioSamples[k]
    }
    val all = ByteArrayOutputStream()
    Mp4Audio.writeAdts(table, 0, open, all)
    assertArrayEquals(expected(0), all.toByteArray())
    assertEquals(listOf(table.offsets[0]), opens) // video bytes in between are skipped, not reopened

    val tail = ByteArrayOutputStream()
    Mp4Audio.writeAdts(table, table.indexAt(3000.0 / 44100), open, tail)
    assertArrayEquals(expected(3), tail.toByteArray())

    val none = ByteArrayOutputStream()
    Mp4Audio.writeAdts(table, table.count, open, none)
    assertEquals(0, none.size())
  }

  @Test
  fun progressiveMp4_malformedThrowsFormatException() {
    val (file, _) = progressiveMp4()
    val moov = Mp4Audio.findMoov(file.size.toLong(), rangeReader(file))
    try {
      Mp4Audio.parseSampleTable(moov.copyOf(moov.size - 30))
      fail("expected Mp4FormatException")
    } catch (_: Mp4FormatException) {
    }
    try {
      // no moov at all
      Mp4Audio.findMoov(100_100, rangeReader(file.copyOf(100_100)))
      fail("expected Mp4FormatException")
    } catch (_: Mp4FormatException) {
    }
  }

  // endregion

  // region network

  private fun ip(s: String) = NetworkUtils.toInt(java.net.InetAddress.getByName(s) as java.net.Inet4Address)

  @Test
  fun subnetHosts_slash24_excludesOwnNetworkAndBroadcast() {
    val hosts = NetworkUtils.subnetHosts(ip("192.168.1.23"), 24)
    assertEquals(253, hosts.size)
    assertEquals("192.168.1.1", NetworkUtils.toAddress(hosts.first()).hostAddress)
    assertEquals("192.168.1.254", NetworkUtils.toAddress(hosts.last()).hostAddress)
    assertTrue(ip("192.168.1.23") !in hosts)
  }

  @Test
  fun subnetHosts_largeSubnetIsNarrowedAroundOwnIp() {
    val hosts = NetworkUtils.subnetHosts(ip("10.0.37.5"), 16)
    assertEquals(509, hosts.size)
    assertEquals("10.0.36.1", NetworkUtils.toAddress(hosts.first()).hostAddress)
    assertEquals("10.0.37.254", NetworkUtils.toAddress(hosts.last()).hostAddress)
  }

  @Test
  fun broadcastAddress_slash24() {
    assertEquals("192.168.178.255", NetworkUtils.toAddress(NetworkUtils.broadcastAddress(ip("192.168.178.40"), 24)).hostAddress)
  }

  @Test
  fun ssdpResponse_recognizesSonos() {
    val headers = SsdpDiscovery.parseHeaders(
      "HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.40:1400/xml/device_description.xml\r\n" +
        "SERVER: Linux UPnP/1.0 Sonos/80.1-55014 (ZPS27)\r\nST: urn:schemas-upnp-org:device:ZonePlayer:1\r\n\r\n"
    )
    assertTrue(SsdpDiscovery.isSonosResponse(headers))
    assertTrue(!SsdpDiscovery.isSonosResponse(mapOf("server" to "Linux UPnP/1.0 FRITZ!Box", "st" to "upnp:rootdevice")))
  }

  // endregion
}
