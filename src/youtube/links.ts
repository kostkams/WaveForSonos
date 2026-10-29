export type ParsedLink = {
  videoId: string | null;
  playlistId: string | null;
  /** Start offset from `t=` / `start=` in seconds */
  startSec: number | null;
};

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];

/** Finds the first URL in free text (the YouTube app shares "Title https://youtu.be/…"). */
export function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  if (m) return m[0];
  const bare = text.match(/\b(?:(?:www\.|m\.|music\.)?youtube\.com|youtu\.be)\/[^\s<>"']+/i);
  return bare ? `https://${bare[0]}` : null;
}

function parseTime(v: string | null): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** Parses a YouTube link (or text containing one). Returns null when it isn't YouTube. */
export function parseYouTubeLink(input: string): ParsedLink | null {
  // Only real links count. A bare 11-character word ("stratovario") looks exactly like a video id
  // but is almost always a search term.
  const raw = extractUrl(input.trim());
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const params = url.searchParams;
  const startSec = parseTime(params.get('t') ?? params.get('start'));
  let playlistId = params.get('list');
  let videoId: string | null = null;

  if (host === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (YT_HOSTS.includes(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') videoId = params.get('v');
    else if (['shorts', 'live', 'embed', 'v', 'e'].includes(parts[0] ?? '')) videoId = parts[1] ?? null;
    else if (parts[0] === 'playlist') videoId = null;
    else if (!playlistId) return null;
  } else {
    return null;
  }

  if (videoId && !VIDEO_ID.test(videoId)) videoId = null;
  // Auto-generated mixes ("RD…") can't be loaded as normal playlists.
  if (playlistId && (playlistId.startsWith('RD') || playlistId === 'WL' || playlistId === 'LL')) playlistId = null;
  if (!videoId && !playlistId) return null;
  return { videoId, playlistId, startSec };
}
