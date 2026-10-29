package de.kostka.sonostube.nativemodule

import expo.modules.kotlin.exception.CodedException
import org.schabi.newpipe.extractor.Image
import org.schabi.newpipe.extractor.InfoItem
import org.schabi.newpipe.extractor.ListExtractor
import org.schabi.newpipe.extractor.MediaFormat
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.exceptions.AgeRestrictedContentException
import org.schabi.newpipe.extractor.exceptions.ContentNotAvailableException
import org.schabi.newpipe.extractor.exceptions.ExtractionException
import org.schabi.newpipe.extractor.exceptions.GeographicRestrictionException
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.exceptions.SignInConfirmNotBotException
import org.schabi.newpipe.extractor.localization.ContentCountry
import org.schabi.newpipe.extractor.localization.Localization
import org.schabi.newpipe.extractor.playlist.PlaylistInfo
import org.schabi.newpipe.extractor.playlist.PlaylistInfoItem
import org.schabi.newpipe.extractor.search.SearchInfo
import org.schabi.newpipe.extractor.services.youtube.YoutubeParsingHelper
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubeSearchQueryHandlerFactory
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.AudioTrackType
import org.schabi.newpipe.extractor.stream.DeliveryMethod
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem
import org.schabi.newpipe.extractor.stream.StreamType
import org.schabi.newpipe.extractor.stream.VideoStream
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

/**
 * A resolved, directly fetchable stream on googlevideo: normally an audio-only M4A (DASH
 * fMP4). [muxed] = no audio-only stream exists (e.g. "made for kids" videos) and this is a
 * progressive MP4 with audio + video (itag 18) whose AAC track the proxy extracts.
 */
data class ResolvedAudio(
  val videoId: String,
  val url: String,
  val contentLength: Long,
  val itag: Int,
  val userAgent: String,
  val isWebClient: Boolean,
  val initEnd: Int,
  val indexStart: Int,
  val indexEnd: Int,
  val durationMs: Long,
  val expiresAtMs: Long,
  val muxed: Boolean = false
)

class YouTubeException(code: String, message: String, cause: Throwable? = null) :
  CodedException(code, message, cause)

object YouTubeRepository {
  private val service get() = ServiceList.YouTube

  @Volatile
  private var initialized = false

  fun ensureInit() {
    if (initialized) return
    synchronized(this) {
      if (initialized) return
      NewPipe.init(OkHttpDownloader.get(), Localization("de", "DE"), ContentCountry("DE"))
      initialized = true
    }
  }

  // region search / metadata

  fun search(query: String, filter: String, pageToken: String?): Map<String, Any?> = wrap {
    val contentFilters = when (filter) {
      "videos" -> listOf(YoutubeSearchQueryHandlerFactory.VIDEOS)
      "playlists" -> listOf(YoutubeSearchQueryHandlerFactory.PLAYLISTS)
      else -> emptyList()
    }
    val handler = service.searchQHFactory.fromQuery(query, contentFilters, "")
    val page = PageToken.decode(pageToken)
    val (items, next) = if (page == null) {
      val info = SearchInfo.getInfo(service, handler)
      info.relatedItems to info.nextPage
    } else {
      val more = SearchInfo.getMoreItems(service, handler, page)
      more.items to more.nextPage
    }
    mapOf(
      "items" to items.mapNotNull { toMediaItem(it) },
      "nextPage" to PageToken.encode(next)
    )
  }

  private data class PlaylistMeta(
    val title: String,
    val channel: String,
    val thumbnail: String?,
    val videoCount: Long?
  )

  private val playlistMeta = ConcurrentHashMap<String, PlaylistMeta>()

  fun getPlaylist(playlistId: String, pageToken: String?): Map<String, Any?> = wrap {
    val url = service.playlistLHFactory.getUrl(playlistId)
    val page = PageToken.decode(pageToken)
    var meta = playlistMeta[playlistId]
    val items: List<StreamInfoItem>
    val next: org.schabi.newpipe.extractor.Page?
    if (page == null || meta == null) {
      val info = PlaylistInfo.getInfo(service, url)
      meta = PlaylistMeta(
        title = info.name ?: "",
        channel = info.uploaderName ?: "",
        thumbnail = pickThumbnail(info.thumbnails),
        videoCount = info.streamCount.takeIf { it >= 0 }
      )
      playlistMeta[playlistId] = meta
      if (page == null) {
        items = info.relatedItems
        next = info.nextPage
      } else {
        val more = PlaylistInfo.getMoreItems(service, url, page)
        items = more.items
        next = more.nextPage
      }
    } else {
      val more = PlaylistInfo.getMoreItems(service, url, page)
      items = more.items
      next = more.nextPage
    }
    mapOf(
      "id" to playlistId,
      "title" to meta.title,
      "channel" to meta.channel,
      "thumbnail" to meta.thumbnail,
      "videoCount" to meta.videoCount?.toDouble(),
      "items" to items.mapNotNull { toMediaItem(it) },
      "nextPage" to PageToken.encode(next)
    )
  }

  fun getVideoInfo(videoId: String): Map<String, Any?> = wrap {
    val info = StreamInfo.getInfo(service, videoUrl(videoId))
    rememberStreamInfo(videoId, info)
    val live = info.streamType == StreamType.LIVE_STREAM || info.streamType == StreamType.AUDIO_LIVE_STREAM
    mapOf(
      "type" to "video",
      "id" to videoId,
      "title" to (info.name ?: ""),
      "channel" to (info.uploaderName ?: ""),
      "durationSec" to if (live || info.duration < 0) null else info.duration.toDouble(),
      "thumbnail" to pickThumbnail(info.thumbnails),
      "viewCount" to info.viewCount.takeIf { it >= 0 }?.toDouble(),
      "videoCount" to null,
      "url" to videoUrl(videoId)
    )
  }

  fun videoUrl(videoId: String) = "https://www.youtube.com/watch?v=$videoId"

  private fun toMediaItem(item: InfoItem): Map<String, Any?>? {
    return when (item) {
      is StreamInfoItem -> {
        val id = runCatching { service.streamLHFactory.getId(item.url) }.getOrNull() ?: return null
        val live = item.streamType == StreamType.LIVE_STREAM || item.streamType == StreamType.AUDIO_LIVE_STREAM
        mapOf(
          "type" to "video",
          "id" to id,
          "title" to (item.name ?: ""),
          "channel" to (item.uploaderName ?: ""),
          "durationSec" to if (live || item.duration <= 0) null else item.duration.toDouble(),
          "thumbnail" to pickThumbnail(item.thumbnails),
          "viewCount" to item.viewCount.takeIf { it >= 0 }?.toDouble(),
          "videoCount" to null,
          "url" to videoUrl(id)
        )
      }
      is PlaylistInfoItem -> {
        val id = runCatching { service.playlistLHFactory.getId(item.url) }.getOrNull() ?: return null
        mapOf(
          "type" to "playlist",
          "id" to id,
          "title" to (item.name ?: ""),
          "channel" to (item.uploaderName ?: ""),
          "durationSec" to null,
          "thumbnail" to pickThumbnail(item.thumbnails),
          "viewCount" to null,
          "videoCount" to item.streamCount.takeIf { it >= 0 && it != ListExtractor.ITEM_COUNT_UNKNOWN }?.toDouble(),
          "url" to (item.url ?: "https://www.youtube.com/playlist?list=$id")
        )
      }
      else -> null // channels etc. are skipped
    }
  }

  /** Picks a medium/high resolution thumbnail (roughly 320–720 px high). */
  fun pickThumbnail(images: List<Image>?): String? {
    if (images.isNullOrEmpty()) return null
    val known = images.filter { it.height > 0 }
    if (known.isNotEmpty()) {
      val sorted = known.sortedBy { it.height }
      val candidate = sorted.firstOrNull { it.height >= 320 } ?: sorted.last()
      return candidate.url
    }
    val order = listOf(Image.ResolutionLevel.MEDIUM, Image.ResolutionLevel.HIGH, Image.ResolutionLevel.LOW, Image.ResolutionLevel.UNKNOWN)
    for (level in order) {
      images.firstOrNull { it.estimatedResolutionLevel == level }?.let { return it.url }
    }
    return images.first().url
  }

  // endregion

  // region audio resolution for the proxy

  private val audioCache = ConcurrentHashMap<String, ResolvedAudio>()
  private val streamInfoCache = ConcurrentHashMap<String, Pair<Long, StreamInfo>>()
  private val resolveLocks = ConcurrentHashMap<String, Any>()

  private fun rememberStreamInfo(videoId: String, info: StreamInfo) {
    streamInfoCache[videoId] = System.currentTimeMillis() to info
    if (streamInfoCache.size > 50) {
      streamInfoCache.entries.minByOrNull { it.value.first }?.let { streamInfoCache.remove(it.key) }
    }
  }

  fun invalidateAudio(videoId: String) {
    audioCache.remove(videoId)
    streamInfoCache.remove(videoId)
  }

  /** Returns a cached or freshly resolved M4A audio stream. Thread-safe per video. */
  fun resolveAudio(videoId: String, forceRefresh: Boolean = false): ResolvedAudio {
    ensureInit()
    val now = System.currentTimeMillis()
    if (!forceRefresh) {
      audioCache[videoId]?.let { if (it.expiresAtMs - REFRESH_MARGIN_MS > now) return it }
    }
    val lock = resolveLocks.getOrPut(videoId) { Any() }
    synchronized(lock) {
      if (!forceRefresh) {
        audioCache[videoId]?.let { if (it.expiresAtMs - REFRESH_MARGIN_MS > System.currentTimeMillis()) return it }
      }
      val resolved = wrap { doResolve(videoId, forceRefresh) }
      audioCache[videoId] = resolved
      return resolved
    }
  }

  private fun doResolve(videoId: String, forceRefresh: Boolean): ResolvedAudio {
    val cachedInfo = streamInfoCache[videoId]
    val info = if (!forceRefresh && cachedInfo != null && System.currentTimeMillis() - cachedInfo.first < 60_000) {
      cachedInfo.second
    } else {
      StreamInfo.getInfo(service, videoUrl(videoId)).also { rememberStreamInfo(videoId, it) }
    }
    val durationMs = { itag: org.schabi.newpipe.extractor.services.youtube.ItagItem? ->
      if (info.duration > 0) info.duration * 1000 else (itag?.approxDurationMs ?: -1L)
    }
    val stream = pickAudioStream(info.audioStreams)
    if (stream == null) {
      val muxed = pickMuxedStream(info.videoStreams)
        ?: throw YouTubeException("ERR_NO_AUDIO_STREAM", "No M4A/AAC audio stream available for $videoId")
      val url = muxed.content
      android.util.Log.i("SonosTubeYT", "$videoId: no audio-only stream, using muxed itag ${muxed.itag}")
      return ResolvedAudio(
        videoId = videoId,
        url = url,
        contentLength = streamLength(muxed.itagItem?.contentLength, url),
        itag = muxed.itag,
        userAgent = streamingUserAgent(url),
        isWebClient = isWebClient(url),
        // Progressive MP4: no DASH init/index ranges.
        initEnd = 0,
        indexStart = 0,
        indexEnd = 0,
        durationMs = durationMs(muxed.itagItem),
        expiresAtMs = expiry(url),
        muxed = true
      )
    }
    val url = stream.content
    val itag = stream.itagItem
    return ResolvedAudio(
      videoId = videoId,
      url = url,
      contentLength = streamLength(itag?.contentLength, url),
      itag = stream.itag,
      userAgent = streamingUserAgent(url),
      isWebClient = isWebClient(url),
      initEnd = stream.initEnd,
      indexStart = stream.indexStart,
      indexEnd = stream.indexEnd,
      durationMs = durationMs(itag),
      expiresAtMs = expiry(url)
    )
  }

  /** Length from the itag info, else the `clen` URL parameter, else -1 (probed later by the proxy). */
  private fun streamLength(itagLength: Long?, url: String): Long {
    if (itagLength != null && itagLength > 0) return itagLength
    return queryParam(url, "clen")?.toLongOrNull()?.takeIf { it > 0 } ?: -1L
  }

  private fun expiry(url: String): Long = queryParam(url, "expire")?.toLongOrNull()?.times(1000)
    ?: (System.currentTimeMillis() + 5 * 3600_000L)

  private fun isWebClient(url: String): Boolean = runCatching {
    YoutubeParsingHelper.isWebStreamingUrl(url) || YoutubeParsingHelper.isWebEmbeddedPlayerStreamingUrl(url)
  }.getOrDefault(false)

  /** Progressive MP4 with an AAC track (itag 18 preferred, else the lowest resolution). */
  private fun pickMuxedStream(streams: List<VideoStream>): VideoStream? {
    val candidates = streams.filter {
      it.format == MediaFormat.MPEG_4 && !it.isVideoOnly() && it.isUrl &&
        it.deliveryMethod == DeliveryMethod.PROGRESSIVE_HTTP &&
        (it.codec?.contains("mp4a", ignoreCase = true) ?: (it.itag == 18 || it.itag == 22))
    }
    return candidates.minWithOrNull(
      compareBy<VideoStream>({ if (it.itag == 18) 0 else 1 }, { if (it.height > 0) it.height else Int.MAX_VALUE })
    )
  }

  private fun pickAudioStream(streams: List<AudioStream>): AudioStream? {
    val candidates = streams.filter {
      it.format == MediaFormat.M4A && it.isUrl && it.deliveryMethod == DeliveryMethod.PROGRESSIVE_HTTP
    }
    if (candidates.isEmpty()) return null
    fun score(s: AudioStream): Int {
      var score = 0
      val trackType = s.audioTrackType
      if (trackType == null || trackType == AudioTrackType.ORIGINAL) score += 1000
      if (s.itagItem?.isDrc != true) score += 500
      if (s.itag == 140) score += 200
      score += (s.averageBitrate.coerceAtLeast(0) / 1000).coerceAtMost(199)
      return score
    }
    return candidates.maxByOrNull { score(it) }
  }

  /** User-Agent matching the client the stream URL was obtained for (as NewPipe's player does). */
  fun streamingUserAgent(url: String): String = runCatching {
    when {
      YoutubeParsingHelper.isAndroidStreamingUrl(url) -> YoutubeParsingHelper.getAndroidUserAgent(null)
      YoutubeParsingHelper.isIosStreamingUrl(url) -> YoutubeParsingHelper.getIosUserAgent(null)
      YoutubeParsingHelper.isVisionOsStreamingUrl(url) -> YoutubeParsingHelper.getVisionOsUserAgent(null)
      else -> OkHttpDownloader.USER_AGENT
    }
  }.getOrDefault(OkHttpDownloader.USER_AGENT)

  fun queryParam(url: String, name: String): String? {
    val q = url.substringAfter('?', "")
    for (part in q.split('&')) {
      val eq = part.indexOf('=')
      if (eq > 0 && part.substring(0, eq) == name) return part.substring(eq + 1)
    }
    return null
  }

  private const val REFRESH_MARGIN_MS = 10 * 60_000L

  // endregion

  private inline fun <T> wrap(block: () -> T): T {
    ensureInit()
    try {
      return block()
    } catch (e: CodedException) {
      throw e
    } catch (e: Exception) {
      // Log the full chain once so failures can be diagnosed with `adb logcat -s SonosTubeYT`.
      android.util.Log.w("SonosTubeYT", "YouTube request failed", e)
      throw mapError(e)
    }
  }

  private fun mapError(e: Exception): Exception = when (e) {
    is ReCaptchaException -> YouTubeException("ERR_YOUTUBE_RECAPTCHA", "YouTube requested a captcha / rate limited: ${e.message}", e)
    is SignInConfirmNotBotException -> YouTubeException("ERR_YOUTUBE_BOT_CHECK", "YouTube asks to confirm you are not a bot: ${e.message}", e)
    is AgeRestrictedContentException -> YouTubeException("ERR_YOUTUBE_AGE_RESTRICTED", "Content is age restricted: ${e.message}", e)
    is GeographicRestrictionException -> YouTubeException("ERR_YOUTUBE_GEO_RESTRICTED", "Content is not available in this country: ${e.message}", e)
    is ContentNotAvailableException -> YouTubeException("ERR_YOUTUBE_UNAVAILABLE", "Content not available: ${e.message}", e)
    is ExtractionException -> YouTubeException("ERR_YOUTUBE_EXTRACTION", "YouTube extraction failed: ${e.message}", e)
    is IOException -> YouTubeException("ERR_NETWORK", "Network error: ${e.message}", e)
    is IllegalArgumentException -> YouTubeException("ERR_INVALID_ARGUMENT", e.message ?: "Invalid argument", e)
    else -> e
  }
}
