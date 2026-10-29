import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { currentLang, localeOf, translate, type Lang } from '@/i18n';
import type { MediaItem } from '@/native';
import { slimItem } from '@/util/media';

export type HistoryEntry = {
  /** Unique per entry */
  key: string;
  item: MediaItem;
  /** epoch ms */
  playedAt: number;
};

export const HISTORY_LIMIT = 500;
/** Replaying the same track within this window moves it to the top instead of adding a new entry. */
export const HISTORY_MERGE_MS = 30 * 60 * 1000;

type HistoryState = {
  entries: HistoryEntry[];
  record: (item: MediaItem, at?: number) => void;
  remove: (key: string) => void;
  clear: () => void;
};

/** Pure helper (tested): newest first, merged and capped. */
export function addToHistory(entries: HistoryEntry[], item: MediaItem, at: number): HistoryEntry[] {
  // Store only what the list needs; thumbnails are URLs, so entries stay small.
  const slim = slimItem(item);
  const recent = entries.find((e) => e.item.id === item.id && at - e.playedAt < HISTORY_MERGE_MS);
  const rest = recent ? entries.filter((e) => e !== recent) : entries;
  const entry: HistoryEntry = { key: recent?.key ?? `${item.id}-${at}`, item: slim, playedAt: at };
  return [entry, ...rest].slice(0, HISTORY_LIMIT);
}

export const useHistory = create<HistoryState>()(
  persist(
    (set) => ({
      entries: [],
      record: (item, at = Date.now()) => set((s) => ({ entries: addToHistory(s.entries, item, at) })),
      remove: (key) => set((s) => ({ entries: s.entries.filter((e) => e.key !== key) })),
      clear: () => set({ entries: [] }),
    }),
    {
      name: 'sonostube-history',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ entries }) => ({ entries }),
    },
  ),
);

/** "Heute", "Gestern", weekday for the last week, else the date. */
export function dayLabel(ts: number, now = Date.now(), lang: Lang = currentLang()): string {
  const d = new Date(ts);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date(now)) - startOf(d)) / 86_400_000);
  const locale = localeOf(lang);
  if (days <= 0) return translate(lang, 'day.today');
  if (days === 1) return translate(lang, 'day.yesterday');
  if (days < 7) return d.toLocaleDateString(locale, { weekday: 'long' });
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

export function groupByDay(entries: HistoryEntry[], now = Date.now(), lang: Lang = currentLang()): { title: string; data: HistoryEntry[] }[] {
  const out: { title: string; data: HistoryEntry[] }[] = [];
  for (const e of entries) {
    const title = dayLabel(e.playedAt, now, lang);
    const last = out[out.length - 1];
    if (last && last.title === title) last.data.push(e);
    else out.push({ title, data: [e] });
  }
  return out;
}
