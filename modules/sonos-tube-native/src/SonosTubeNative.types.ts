// Shared contract between the Kotlin module and the app code.

export type SearchFilter = 'all' | 'videos' | 'playlists';

export type MediaItem = {
  /** 'local' = audio file on the phone (picked via the system file picker) */
  type: 'video' | 'playlist' | 'local';
  /** YouTube video id, playlist id, or for local files the base64url-encoded content URI */
  id: string;
  title: string;
  channel: string;
  /** Seconds; null for playlists or live streams */
  durationSec: number | null;
  thumbnail: string | null;
  viewCount: number | null;
  /** Only for playlists */
  videoCount: number | null;
  /** YouTube URL, or the content:// URI of a local file */
  url: string;
  /** Local files only: file extension Sonos needs to pick the decoder (mp3, m4a, flac, …) */
  ext?: string | null;
  /** Local files only */
  sizeBytes?: number | null;
};

export type SearchPage = {
  items: MediaItem[];
  /** Opaque token for the next page, null when there is none */
  nextPage: string | null;
};

export type PlaylistPage = {
  id: string;
  title: string;
  channel: string;
  thumbnail: string | null;
  videoCount: number | null;
  items: MediaItem[];
  nextPage: string | null;
};

export type PreparedStream = {
  /** Only a muxed audio+video MP4 exists (e.g. "made for kids"); the proxy extracts the AAC track. */
  muxed: boolean;
};

export type ProxyInfo = {
  /** e.g. http://192.168.1.23:8080 */
  baseUrl: string;
  port: number;
};

export type SonosDiscovery = {
  ip: string;
  /** LOCATION header, e.g. http://192.168.1.40:1400/xml/device_description.xml */
  location: string;
};

export type NowPlaying = {
  title: string;
  artist: string;
  artworkUrl: string | null;
  playing: boolean;
};

export type MediaAction = 'play' | 'pause' | 'next' | 'previous' | 'stop';

export type SonosTubeNativeEvents = {
  /** Text shared into the app (ACTION_SEND text/plain or ACTION_VIEW youtube link) */
  onSharedText: (event: { text: string }) => void;
  /** Button pressed in the playback notification */
  onMediaAction: (event: { action: MediaAction }) => void;
  /** Hardware volume key pressed while the remote volume is active; target Sonos volume 0–100 */
  onVolumeKey: (event: { volume: number }) => void;
};

/**
 * Material You system palettes (Android 12+), keyed like "accent1_500".
 * Palettes: accent1, accent2, accent3, neutral1, neutral2.
 * Tones: 0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000. Values are "#RRGGBB".
 */
export type DynamicColors = Record<string, string>;
