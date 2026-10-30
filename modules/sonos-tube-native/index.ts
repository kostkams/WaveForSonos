import { NativeModule, requireNativeModule } from 'expo';

import type {
  DynamicColors,
  NowPlaying,
  PlaylistPage,
  PreparedStream,
  ProxyInfo,
  SearchFilter,
  SearchPage,
  SonosDiscovery,
  SonosTubeNativeEvents,
  MediaItem,
} from './src/SonosTubeNative.types';

export * from './src/SonosTubeNative.types';

declare class SonosTubeNativeModule extends NativeModule<SonosTubeNativeEvents> {
  /** Search YouTube. `page` is the token from a previous result. */
  search(query: string, filter: SearchFilter, page: string | null): Promise<SearchPage>;
  /** Load a playlist by id. */
  getPlaylist(playlistId: string, page: string | null): Promise<PlaylistPage>;
  /** Basic metadata for one video. */
  getVideoInfo(videoId: string): Promise<MediaItem>;
  /**
   * Resolves the stream the proxy will serve for a video (rejects with a coded error, e.g.
   * ERR_NO_AUDIO_STREAM, when nothing is playable). `muxed` = no audio-only stream exists; such
   * videos must be played via the ADTS route (/stream/<id>.aac).
   */
  prepareStream(videoId: string): Promise<PreparedStream>;

  /** Opens the system file picker for audio files (multiple). Resolves with [] when cancelled. */
  pickAudioFiles(): Promise<MediaItem[]>;
  /** Reads the metadata of a previously picked file again (rejects if it is gone). */
  describeLocalFile(uri: string): Promise<MediaItem>;

  /** Starts the foreground service + HTTP stream proxy (idempotent). */
  startProxy(): Promise<ProxyInfo>;
  /** Stops proxy and foreground service. */
  stopProxy(): Promise<void>;
  /** Updates the playback notification. */
  updateNowPlaying(info: NowPlaying): void;
  /**
   * Lets the hardware volume keys control Sonos (0–100, shown in the system volume UI).
   * -1 gives the keys back to the phone's media volume. Only effective while the proxy service runs.
   */
  setRemoteVolume(volume: number): void;
  /** Language for the notification texts ('de' | 'en'). */
  setLanguage(lang: 'de' | 'en'): void;

  /** SSDP search for Sonos ZonePlayers on the local network. */
  discoverSonos(timeoutMs: number): Promise<SonosDiscovery[]>;
  /**
   * Fallback when SSDP finds nothing: IPs in the Wi-Fi subnet that accept a TCP connection on the
   * Sonos port 1400. Callers still have to confirm they are Sonos speakers.
   */
  scanSonosSubnet(connectTimeoutMs: number): Promise<string[]>;
  /** IPv4 address of the Wi-Fi interface, or null. */
  getLocalIp(): string | null;

  /** Text from the share/view intent that launched the app (consumed on read). */
  getInitialSharedText(): string | null;

  /** Material You palettes, null below Android 12. */
  getDynamicColors(): DynamicColors | null;

  isIgnoringBatteryOptimizations(): boolean;
  /** Opens the system dialog to exempt the app from battery optimizations. */
  requestIgnoreBatteryOptimizations(): void;
}

export default requireNativeModule<SonosTubeNativeModule>('SonosTubeNative');
