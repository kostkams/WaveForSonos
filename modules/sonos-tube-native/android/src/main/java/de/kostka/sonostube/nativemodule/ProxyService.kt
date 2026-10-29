package de.kostka.sonostube.nativemodule

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.media.VolumeProviderCompat
import androidx.media.app.NotificationCompat.MediaStyle
import okhttp3.Request

/**
 * Foreground service (type mediaPlayback) that hosts the [StreamProxyServer], keeps Wi-Fi and
 * CPU awake while Sonos pulls audio, and shows a media-style notification.
 */
class ProxyService : Service() {
  private val server = StreamProxyServer()
  private var wifiLock: WifiManager.WifiLock? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private lateinit var session: MediaSessionCompat
  private val mainHandler = Handler(Looper.getMainLooper())

  private var artworkUrl: String? = null
  private var artwork: Bitmap? = null
  @Volatile private var serverStarting = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createChannel()
    session = MediaSessionCompat(this, "Wave for Sonos").apply {
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() = ServiceBridge.emitMediaAction("play")
        override fun onPause() = ServiceBridge.emitMediaAction("pause")
        override fun onSkipToNext() = ServiceBridge.emitMediaAction("next")
        override fun onSkipToPrevious() = ServiceBridge.emitMediaAction("previous")
        override fun onStop() = ServiceBridge.emitMediaAction("stop")
      })
      isActive = true
    }
    ServiceBridge.nowPlayingChanged = { mainHandler.post { refreshNowPlaying() } }
    ServiceBridge.remoteVolumeChanged = { mainHandler.post { applyRemoteVolume() } }
    ServiceBridge.languageChanged = {
      mainHandler.post {
        createChannel()
        postNotification()
      }
    }
    applyRemoteVolume()
  }

  // region remote volume (hardware keys → Sonos)

  private var volumeProvider: VolumeProviderCompat? = null

  /**
   * While a Sonos volume is known, the media session plays "remotely": Android then routes the
   * hardware volume keys to [volumeProvider] instead of the phone's media volume, and the system
   * volume slider shows the Sonos level.
   */
  private fun applyRemoteVolume() {
    val v = ServiceBridge.remoteVolume
    if (v < 0) {
      if (volumeProvider != null) {
        volumeProvider = null
        session.setPlaybackToLocal(android.media.AudioManager.STREAM_MUSIC)
      }
      return
    }
    val existing = volumeProvider
    if (existing != null) {
      if (existing.currentVolume != v) existing.currentVolume = v
      return
    }
    val provider = object : VolumeProviderCompat(VOLUME_CONTROL_ABSOLUTE, 100, v) {
      override fun onSetVolumeTo(volume: Int) {
        val target = volume.coerceIn(0, 100)
        currentVolume = target
        ServiceBridge.emitVolume(target)
      }

      override fun onAdjustVolume(direction: Int) {
        if (direction == 0) return
        val target = (currentVolume + direction * VOLUME_STEP).coerceIn(0, 100)
        if (target == currentVolume) return
        currentVolume = target
        ServiceBridge.emitVolume(target)
      }
    }
    volumeProvider = provider
    session.setPlaybackToRemote(provider)
  }

  // endregion

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_PLAY -> ServiceBridge.emitMediaAction("play")
      ACTION_PAUSE -> ServiceBridge.emitMediaAction("pause")
      ACTION_NEXT -> ServiceBridge.emitMediaAction("next")
      ACTION_PREVIOUS -> ServiceBridge.emitMediaAction("previous")
      ACTION_STOP -> ServiceBridge.emitMediaAction("stop")
      ACTION_SHUTDOWN -> {
        shutdown()
        return START_NOT_STICKY
      }
    }
    // Always (re-)enter the foreground state: required within a few seconds of startForegroundService().
    goForeground()
    ensureServer()
    return START_STICKY
  }

  private fun goForeground() {
    val notification = buildNotification()
    try {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        notification,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0
      )
    } catch (e: Exception) {
      Log.e(TAG, "startForeground failed", e)
      ServiceBridge.onProxyFailed(e)
      stopSelf()
    }
  }

  private fun ensureServer() {
    if (server.isRunning) {
      ServiceBridge.onProxyStarted(server.port)
      return
    }
    if (serverStarting) return
    serverStarting = true
    acquireLocks()
    Thread({
      try {
        YouTubeRepository.ensureInit()
        val port = server.start(StreamProxyServer.DEFAULT_PORT)
        ServiceBridge.onProxyStarted(port)
      } catch (e: Exception) {
        Log.e(TAG, "Failed to start proxy", e)
        ServiceBridge.onProxyFailed(e)
        mainHandler.post { shutdown() }
      } finally {
        serverStarting = false
      }
    }, "SonosTubeProxy-start").start()
  }

  private fun shutdown() {
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    ServiceBridge.nowPlayingChanged = null
    ServiceBridge.remoteVolumeChanged = null
    ServiceBridge.languageChanged = null
    volumeProvider = null
    Thread { server.stop() }.start()
    ServiceBridge.onProxyStopped()
    releaseLocks()
    session.isActive = false
    session.release()
    super.onDestroy()
  }

  // region locks

  @SuppressLint("WakelockTimeout")
  private fun acquireLocks() {
    try {
      if (wifiLock == null) {
        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        @Suppress("DEPRECATION")
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
        wifiLock = wm.createWifiLock(mode, "SonosTube:proxy").apply { setReferenceCounted(false); acquire() }
      }
    } catch (e: Exception) {
      Log.w(TAG, "WifiLock failed", e)
    }
    try {
      if (wakeLock == null) {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SonosTube:proxy").apply { setReferenceCounted(false); acquire() }
      }
    } catch (e: Exception) {
      Log.w(TAG, "WakeLock failed", e)
    }
  }

  private fun releaseLocks() {
    try { wifiLock?.takeIf { it.isHeld }?.release() } catch (_: Exception) {}
    try { wakeLock?.takeIf { it.isHeld }?.release() } catch (_: Exception) {}
    wifiLock = null
    wakeLock = null
  }

  // endregion

  // region notification

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      // Re-creating an existing channel only updates its name/description (shown in system settings).
      val channel = NotificationChannel(CHANNEL_ID, text("channel"), NotificationManager.IMPORTANCE_LOW).apply {
        description = text("channelDescription")
        setShowBadge(false)
      }
      nm.createNotificationChannel(channel)
    }
  }

  private fun servicePendingIntent(action: String, requestCode: Int): PendingIntent {
    val intent = Intent(this, ProxyService::class.java).setAction(action)
    return PendingIntent.getService(this, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun buildNotification(): Notification {
    val np = ServiceBridge.nowPlaying
    val playing = np?.playing == true
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val contentIntent = launch?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.sonostube_ic_notification)
      .setContentTitle(np?.title?.takeIf { it.isNotBlank() } ?: "Wave for Sonos")
      .setContentText(np?.artist?.takeIf { it.isNotBlank() } ?: text("ready"))
      .setContentIntent(contentIntent)
      .setDeleteIntent(servicePendingIntent(ACTION_STOP, 5))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .addAction(android.R.drawable.ic_media_previous, text("previous"), servicePendingIntent(ACTION_PREVIOUS, 1))
      .addAction(
        if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
        if (playing) text("pause") else text("play"),
        servicePendingIntent(if (playing) ACTION_PAUSE else ACTION_PLAY, 2)
      )
      .addAction(android.R.drawable.ic_media_next, text("next"), servicePendingIntent(ACTION_NEXT, 3))
      .setStyle(
        MediaStyle()
          .setMediaSession(session.sessionToken)
          .setShowActionsInCompactView(0, 1, 2)
          .setShowCancelButton(true)
          .setCancelButtonIntent(servicePendingIntent(ACTION_STOP, 4))
      )
    artwork?.let { builder.setLargeIcon(it) }
    return builder.build()
  }

  private fun refreshNowPlaying() {
    val np = ServiceBridge.nowPlaying ?: return
    val state = if (np.playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
    session.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setActions(
          PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or PlaybackStateCompat.ACTION_STOP
        )
        .setState(state, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, if (np.playing) 1f else 0f)
        .build()
    )
    val meta = MediaMetadataCompat.Builder()
      .putString(MediaMetadataCompat.METADATA_KEY_TITLE, np.title)
      .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, np.artist)
    if (np.artworkUrl == artworkUrl) artwork?.let { meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it) }
    session.setMetadata(meta.build())

    if (np.artworkUrl != artworkUrl) {
      artworkUrl = np.artworkUrl
      artwork = null
      np.artworkUrl?.let { loadArtwork(it) }
    }
    postNotification()
  }

  private fun postNotification() {
    try {
      NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, buildNotification())
    } catch (e: SecurityException) {
      // POST_NOTIFICATIONS not granted – the service keeps running anyway.
    }
  }

  private fun loadArtwork(url: String) {
    Thread({
      try {
        val req = Request.Builder().url(url).header("User-Agent", OkHttpDownloader.USER_AGENT).build()
        GoogleVideo.client.newCall(req).execute().use { resp ->
          if (!resp.isSuccessful) return@Thread
          val bytes = resp.body?.bytes() ?: return@Thread
          val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@Thread
          val scaled = scaleDown(bmp, 512)
          mainHandler.post {
            if (artworkUrl == url) {
              artwork = scaled
              refreshNowPlaying()
            }
          }
        }
      } catch (e: Exception) {
        Log.d(TAG, "artwork load failed: ${e.message}")
      }
    }, "SonosTube-artwork").start()
  }

  private fun scaleDown(bmp: Bitmap, max: Int): Bitmap {
    val w = bmp.width
    val h = bmp.height
    if (w <= max && h <= max) return bmp
    val f = max.toFloat() / maxOf(w, h)
    return Bitmap.createScaledBitmap(bmp, (w * f).toInt().coerceAtLeast(1), (h * f).toInt().coerceAtLeast(1), true)
  }

  // endregion

  /** Notification texts in the app's language (set from JS via setLanguage). */
  private fun text(key: String): String = (if (ServiceBridge.language == "en") TEXTS_EN else TEXTS_DE)[key] ?: key

  companion object {
    private val TEXTS_DE = mapOf(
      "channel" to "Wiedergabe",
      "channelDescription" to "Steuerung der Sonos-Wiedergabe",
      "ready" to "Bereit für Sonos",
      "previous" to "Zurück",
      "pause" to "Pause",
      "play" to "Abspielen",
      "next" to "Weiter"
    )
    private val TEXTS_EN = mapOf(
      "channel" to "Playback",
      "channelDescription" to "Controls Sonos playback",
      "ready" to "Ready for Sonos",
      "previous" to "Previous",
      "pause" to "Pause",
      "play" to "Play",
      "next" to "Next"
    )
    private const val TAG = "SonosTubeService"
    const val CHANNEL_ID = "playback"
    const val NOTIFICATION_ID = 0x50A05
    const val ACTION_START = "de.tetranova.waveforsonos.action.START"
    const val ACTION_SHUTDOWN = "de.tetranova.waveforsonos.action.SHUTDOWN"
    const val ACTION_PLAY = "de.tetranova.waveforsonos.action.PLAY"
    const val ACTION_PAUSE = "de.tetranova.waveforsonos.action.PAUSE"
    const val ACTION_NEXT = "de.tetranova.waveforsonos.action.NEXT"
    const val ACTION_PREVIOUS = "de.tetranova.waveforsonos.action.PREVIOUS"
    const val ACTION_STOP = "de.tetranova.waveforsonos.action.STOP"
    /** Volume change per hardware key press (Sonos scale 0–100). */
    const val VOLUME_STEP = 2
  }
}
