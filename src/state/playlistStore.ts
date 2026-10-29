import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { t } from '@/i18n';
import type { MediaItem } from '@/native';

export type UserPlaylist = {
  id: string;
  name: string;
  items: MediaItem[];
  createdAt: number;
  updatedAt: number;
};

type PlaylistState = {
  playlists: UserPlaylist[];
  /** Creates a playlist and returns its id */
  create: (name: string, items?: MediaItem[]) => string;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  /** Adds videos that aren't in the playlist yet; returns how many were added */
  addItems: (id: string, items: MediaItem[]) => number;
  removeAt: (id: string, index: number) => void;
  move: (id: string, from: number, to: number) => void;
};

/** Only videos are stored, slimmed down to what the lists need. */
export function slim(item: MediaItem): MediaItem {
  return {
    type: 'video',
    id: item.id,
    title: item.title,
    channel: item.channel,
    durationSec: item.durationSec,
    thumbnail: item.thumbnail,
    viewCount: null,
    videoCount: null,
    url: item.url,
  };
}

/** Pure helper (tested): appends new videos, skipping ones already in the list. */
export function mergeItems(existing: MediaItem[], add: MediaItem[]): { items: MediaItem[]; added: number } {
  const seen = new Set(existing.map((i) => i.id));
  const fresh: MediaItem[] = [];
  for (const it of add) {
    if (it.type !== 'video' || seen.has(it.id)) continue;
    seen.add(it.id);
    fresh.push(slim(it));
  }
  return { items: [...existing, ...fresh], added: fresh.length };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

export function uniqueName(playlists: UserPlaylist[], base: string): string {
  const names = new Set(playlists.map((p) => p.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

let seq = 0;
const newId = () => `pl-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const usePlaylists = create<PlaylistState>()(
  persist(
    (set, get) => ({
      playlists: [],
      create: (name, items = []) => {
        const id = newId();
        const now = Date.now();
        const clean = name.trim() || t('add.defaultName');
        const { items: merged } = mergeItems([], items);
        set((s) => ({ playlists: [{ id, name: uniqueName(s.playlists, clean), items: merged, createdAt: now, updatedAt: now }, ...s.playlists] }));
        return id;
      },
      rename: (id, name) =>
        set((s) => ({
          playlists: s.playlists.map((p) => (p.id === id && name.trim() ? { ...p, name: name.trim(), updatedAt: Date.now() } : p)),
        })),
      remove: (id) => set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) })),
      addItems: (id, items) => {
        const pl = get().playlists.find((p) => p.id === id);
        if (!pl) return 0;
        const { items: merged, added } = mergeItems(pl.items, items);
        if (added) {
          set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, items: merged, updatedAt: Date.now() } : p)) }));
        }
        return added;
      },
      removeAt: (id, index) =>
        set((s) => ({
          playlists: s.playlists.map((p) => (p.id === id ? { ...p, items: p.items.filter((_, i) => i !== index), updatedAt: Date.now() } : p)),
        })),
      move: (id, from, to) =>
        set((s) => ({
          playlists: s.playlists.map((p) => (p.id === id ? { ...p, items: moveItem(p.items, from, to), updatedAt: Date.now() } : p)),
        })),
    }),
    {
      name: 'sonostube-playlists',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ playlists }) => ({ playlists }),
    },
  ),
);

export const totalDuration = (items: MediaItem[]) => items.reduce((sum, i) => sum + (i.durationSec ?? 0), 0);

export function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
