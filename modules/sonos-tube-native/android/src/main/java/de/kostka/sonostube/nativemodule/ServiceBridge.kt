package de.kostka.sonostube.nativemodule

import kotlinx.coroutines.CompletableDeferred

data class NowPlayingState(
  val title: String,
  val artist: String,
  val artworkUrl: String?,
  val playing: Boolean
)

/** Process-wide glue between [ProxyService] and [SonosTubeNativeModule]. */
object ServiceBridge {
  /** Receives notification / media-session button presses ('play', 'pause', 'next', 'previous', 'stop'). */
  @Volatile
  var mediaActionListener: ((String) -> Unit)? = null

  @Volatile
  var nowPlaying: NowPlayingState? = null

  /** Called by the service when now-playing info changes. */
  @Volatile
  var nowPlayingChanged: (() -> Unit)? = null

  /** Receives the target Sonos volume (0–100) when the hardware volume keys are pressed. */
  @Volatile
  var volumeListener: ((Int) -> Unit)? = null

  /** Current Sonos volume shown by the system volume UI, or -1 = keys control the phone as usual. */
  @Volatile
  var remoteVolume: Int = -1

  /** Called by the service when [remoteVolume] changes. */
  @Volatile
  var remoteVolumeChanged: (() -> Unit)? = null

  fun emitVolume(volume: Int) {
    volumeListener?.invoke(volume)
  }

  fun updateRemoteVolume(volume: Int) {
    remoteVolume = volume.coerceIn(-1, 100)
    remoteVolumeChanged?.invoke()
  }

  /** UI language of the app ("de" or "en"), used for the notification texts. */
  @Volatile
  var language: String = "de"

  /** Called by the service when [language] changes. */
  @Volatile
  var languageChanged: (() -> Unit)? = null

  fun updateLanguage(lang: String) {
    val l = if (lang == "en") "en" else "de"
    if (l == language) return
    language = l
    languageChanged?.invoke()
  }

  /** Port the proxy currently listens on, or -1. */
  @Volatile
  var proxyPort: Int = -1

  private val waiters = mutableListOf<CompletableDeferred<Int>>()

  fun emitMediaAction(action: String) {
    mediaActionListener?.invoke(action)
  }

  fun updateNowPlaying(state: NowPlayingState) {
    nowPlaying = state
    nowPlayingChanged?.invoke()
  }

  @Synchronized
  fun awaitPort(): CompletableDeferred<Int> {
    val d = CompletableDeferred<Int>()
    if (proxyPort > 0) d.complete(proxyPort) else waiters.add(d)
    return d
  }

  @Synchronized
  fun onProxyStarted(port: Int) {
    proxyPort = port
    waiters.forEach { it.complete(port) }
    waiters.clear()
  }

  @Synchronized
  fun onProxyFailed(error: Throwable) {
    proxyPort = -1
    waiters.forEach { it.completeExceptionally(error) }
    waiters.clear()
  }

  @Synchronized
  fun onProxyStopped() {
    proxyPort = -1
  }
}
