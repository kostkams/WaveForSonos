package de.kostka.sonostube.nativemodule

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.util.Locale

class NowPlayingRecord : Record {
  @Field
  val title: String = ""

  @Field
  val artist: String = ""

  @Field
  val artworkUrl: String? = null

  @Field
  val playing: Boolean = false
}

class SonosTubeNativeModule : Module() {
  /** Pending result of the system file picker (pickAudioFiles). */
  private var pickResult: CompletableDeferred<List<Uri>>? = null
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("SonosTubeNative")

    Events(EVENT_SHARED_TEXT, EVENT_MEDIA_ACTION, EVENT_VOLUME_KEY)

    OnCreate {
      appContext.reactContext?.let { LocalAudio.init(it) }
      ServiceBridge.mediaActionListener = { action ->
        try {
          sendEvent(EVENT_MEDIA_ACTION, mapOf("action" to action))
        } catch (_: Exception) {
        }
      }
      ServiceBridge.volumeListener = { volume ->
        try {
          sendEvent(EVENT_VOLUME_KEY, mapOf("volume" to volume))
        } catch (_: Exception) {
        }
      }
    }

    OnDestroy {
      ServiceBridge.mediaActionListener = null
      ServiceBridge.volumeListener = null
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_PICK_AUDIO) return@OnActivityResult
      val data = payload.data
      val uris = mutableListOf<Uri>()
      if (payload.resultCode == android.app.Activity.RESULT_OK && data != null) {
        val clip = data.clipData
        if (clip != null) {
          for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { uris.add(it) }
        } else {
          data.data?.let { uris.add(it) }
        }
      }
      pickResult?.complete(uris)
      pickResult = null
    }

    // region local files

    /** Opens the system picker for audio files; resolves with their metadata (empty if cancelled). */
    AsyncFunction("pickAudioFiles") Coroutine { ->
      val activity = appContext.currentActivity ?: throw CodedException("ERR_NO_ACTIVITY", "No foreground activity", null)
      LocalAudio.init(activity)
      val result = CompletableDeferred<List<Uri>>()
      pickResult?.complete(emptyList())
      pickResult = result
      withContext(Dispatchers.Main) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = "audio/*"
          putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        activity.startActivityForResult(intent, REQUEST_PICK_AUDIO)
      }
      val uris = result.await()
      withContext(Dispatchers.IO) {
        uris.map { uri ->
          LocalAudio.persistPermission(uri)
          LocalAudio.describe(uri)
        }
      }
    }

    /** Re-reads metadata of an already picked file (e.g. to check it still exists). */
    AsyncFunction("describeLocalFile") Coroutine { uri: String ->
      withContext(Dispatchers.IO) { LocalAudio.describe(Uri.parse(uri)) }
    }

    // endregion

    OnNewIntent { intent ->
      val text = consumeSharedText(intent)
      if (text != null) sendEvent(EVENT_SHARED_TEXT, mapOf("text" to text))
    }

    // region YouTube

    AsyncFunction("search") Coroutine { query: String, filter: String, page: String? ->
      withContext(Dispatchers.IO) { YouTubeRepository.search(query, filter, page) }
    }

    AsyncFunction("getPlaylist") Coroutine { playlistId: String, page: String? ->
      withContext(Dispatchers.IO) { YouTubeRepository.getPlaylist(playlistId, page) }
    }

    AsyncFunction("getVideoInfo") Coroutine { videoId: String ->
      withContext(Dispatchers.IO) { YouTubeRepository.getVideoInfo(videoId) }
    }

    // endregion

    // region proxy / service

    AsyncFunction("startProxy") Coroutine { ->
      val ctx = context
      requestNotificationPermissionIfNeeded()
      val deferred = ServiceBridge.awaitPort()
      val port = try {
        try {
          val intent = Intent(ctx, ProxyService::class.java).setAction(ProxyService.ACTION_START)
          ContextCompat.startForegroundService(ctx, intent)
        } catch (e: Exception) {
          throw CodedException("ERR_PROXY_START", "Could not start the foreground service: ${e.message}", e)
        }
        try {
          withTimeout(15_000) { deferred.await() }
        } catch (e: TimeoutCancellationException) {
          throw CodedException("ERR_PROXY_TIMEOUT", "Proxy did not start within 15 s", e)
        } catch (e: CodedException) {
          throw e
        } catch (e: Exception) {
          throw CodedException("ERR_PROXY_START", "Proxy failed to start: ${e.message}", e)
        }
      } finally {
        // No-op when the deferred was completed; otherwise it would stay in the waiter list forever.
        ServiceBridge.cancelWait(deferred)
      }
      val ip = withContext(Dispatchers.IO) { NetworkUtils.getLocalIp(ctx) } ?: "127.0.0.1"
      mapOf("baseUrl" to "http://$ip:$port", "port" to port)
    }

    AsyncFunction("stopProxy") Coroutine { ->
      val ctx = context
      ctx.stopService(Intent(ctx, ProxyService::class.java))
      Unit
    }

    Function("updateNowPlaying") { info: NowPlayingRecord ->
      ServiceBridge.updateNowPlaying(
        NowPlayingState(
          title = info.title,
          artist = info.artist,
          artworkUrl = info.artworkUrl?.takeIf { it.isNotBlank() },
          playing = info.playing
        )
      )
    }

    Function("setLanguage") { lang: String ->
      ServiceBridge.updateLanguage(lang)
    }

    Function("setRemoteVolume") { volume: Int ->
      ServiceBridge.updateRemoteVolume(volume)
    }

    // endregion

    // region network

    AsyncFunction("discoverSonos") Coroutine { timeoutMs: Double ->
      val ctx = context
      withContext(Dispatchers.IO) {
        try {
          SsdpDiscovery.discover(ctx, timeoutMs.toLong())
        } catch (e: Exception) {
          throw CodedException("ERR_SSDP", "SSDP discovery failed: ${e.message}", e)
        }
      }
    }

    Function("getLocalIp") {
      NetworkUtils.getLocalIp(context)
    }

    // endregion

    // region intents / system

    Function("getInitialSharedText") {
      val activity = appContext.currentActivity ?: return@Function null
      consumeSharedText(activity.intent)
    }

    Function("getDynamicColors") {
      dynamicColors()
    }

    Function("isIgnoringBatteryOptimizations") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    Function("requestIgnoreBatteryOptimizations") {
      val ctx = context
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        ctx.startActivity(intent)
      } catch (e: Exception) {
        // Some OEM ROMs lack the dialog: fall back to the battery optimization settings list.
        try {
          ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
        }
      }
      Unit
    }

    // endregion
  }

  private fun requestNotificationPermissionIfNeeded() {
    if (Build.VERSION.SDK_INT < 33) return
    val ctx = context
    if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
    val activity = appContext.currentActivity ?: return
    activity.runOnUiThread {
      try {
        ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 0x50A0)
      } catch (_: Exception) {
      }
    }
  }

  private fun dynamicColors(): Map<String, String>? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
    val ctx = context
    val result = LinkedHashMap<String, String>()
    for (palette in PALETTES) {
      for (tone in TONES) {
        val resId = try {
          android.R.color::class.java.getField("system_${palette}_$tone").getInt(null)
        } catch (_: Exception) {
          continue
        }
        val color = ctx.getColor(resId)
        result["${palette}_$tone"] = String.format(Locale.ROOT, "#%06X", color and 0xFFFFFF)
      }
    }
    return result
  }

  companion object {
    private const val EVENT_SHARED_TEXT = "onSharedText"
    private const val EVENT_MEDIA_ACTION = "onMediaAction"
    private const val EVENT_VOLUME_KEY = "onVolumeKey"
    private const val REQUEST_PICK_AUDIO = 0x5A17
    private const val CONSUMED_EXTRA = "de.kostka.sonostube.SHARED_TEXT_CONSUMED"
    private val PALETTES = listOf("accent1", "accent2", "accent3", "neutral1", "neutral2")
    private val TONES = listOf(0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000)
    private val YOUTUBE_HOSTS = setOf("youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be")

    /** Extracts shared text / YouTube link from an intent and marks it consumed. */
    fun consumeSharedText(intent: Intent?): String? {
      if (intent == null || intent.getBooleanExtra(CONSUMED_EXTRA, false)) return null
      val text = when (intent.action) {
        Intent.ACTION_SEND -> {
          val type = intent.type ?: ""
          if (type.startsWith("text/") || type.isEmpty()) {
            intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
              ?: intent.getStringExtra(Intent.EXTRA_SUBJECT)
          } else null
        }
        Intent.ACTION_VIEW -> {
          val data = intent.data
          val scheme = data?.scheme?.lowercase(Locale.ROOT)
          val host = data?.host?.lowercase(Locale.ROOT)
          if ((scheme == "https" || scheme == "http") && host in YOUTUBE_HOSTS) data.toString() else null
        }
        else -> null
      }?.trim()?.takeIf { it.isNotEmpty() }
      if (text != null) intent.putExtra(CONSUMED_EXTRA, true)
      return text
    }
  }
}
