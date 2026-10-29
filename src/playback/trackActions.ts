import { router } from 'expo-router';

import type { RowAction } from '@/components/MediaRow';
import { t, tn } from '@/i18n';
import type { MediaItem } from '@/native';
import { enqueue } from './controller';

// Items for the "add to playlist" sheet are handed over in memory (too big for route params).
let pending: { items: MediaItem[]; title: string } | null = null;

export function takePendingAdd() {
  const p = pending;
  pending = null;
  return p;
}

/** Opens the sheet to add videos to one of the user's playlists (or a new one). */
export function openAddToPlaylist(items: MediaItem[], title?: string) {
  const videos = items.filter((i) => i.type === 'video');
  if (!videos.length) return;
  pending = { items: videos, title: title ?? (videos.length === 1 ? videos[0].title : tn('common.tracks', videos.length)) };
  router.push('/add-to-playlist');
}

/** Standard ⋮ menu for a video row. */
export function trackActions(item: MediaItem, notify: (msg: string) => void, extra: RowAction[] = []): RowAction[] {
  return [
    {
      label: t('track.addToQueue'),
      icon: 'playlist-plus',
      onPress: () => {
        enqueue([item]);
        notify(t('track.addedToQueue'));
      },
    },
    { label: t('track.addToPlaylist'), icon: 'playlist-music', onPress: () => openAddToPlaylist([item]) },
    ...extra,
  ];
}
