import { parseYouTubeLink } from '@/youtube/links';

// A YouTube link that opens the app arrives twice: once as a route (+native-intent)
// and once from the native module's share/view intent handling. Only open it once.

let last: { key: string; at: number } | null = null;

const keyOf = (text: string) => {
  const l = parseYouTubeLink(text);
  return l ? `${l.videoId ?? ''}|${l.playlistId ?? ''}` : text.trim();
};

export function markShared(text: string) {
  last = { key: keyOf(text), at: Date.now() };
}

/** True if this link was already handled in the last few seconds. */
export function isDuplicateShare(text: string): boolean {
  const key = keyOf(text);
  const dup = !!last && last.key === key && Date.now() - last.at < 5000;
  markShared(text);
  return dup;
}
