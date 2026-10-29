import type { MediaItem } from '@/native';

/** Videos and local files can be played; YouTube playlists have to be opened first. */
export const isPlayable = (item: MediaItem) => item.type === 'video' || item.type === 'local';

export const isLocal = (item: MediaItem) => item.type === 'local';

/** Copy without fields the lists don't need (keeps persisted stores small). */
export function slimItem(item: MediaItem): MediaItem {
  return {
    type: item.type === 'local' ? 'local' : 'video',
    id: item.id,
    title: item.title,
    channel: item.channel,
    durationSec: item.durationSec,
    thumbnail: item.thumbnail,
    viewCount: null,
    videoCount: null,
    url: item.url,
    ...(item.type === 'local' ? { ext: item.ext ?? null } : {}),
  };
}

/** File name of a cover stored by the native side (…/local-art/<sha1>.jpg), or null. */
export function localArtName(thumbnail: string | null | undefined): string | null {
  const m = thumbnail?.match(/local-art\/([0-9a-f]{40}\.jpg)$/);
  return m ? m[1] : null;
}
