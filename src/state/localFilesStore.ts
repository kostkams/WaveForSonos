import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { MediaItem } from '@/native';
import { slimItem } from '@/util/media';

type LocalFilesState = {
  /** Audio files picked from the phone, newest first */
  files: MediaItem[];
  /** Adds files that aren't in the list yet; returns how many were new */
  add: (items: MediaItem[]) => number;
  remove: (id: string) => void;
  clear: () => void;
};

/** Pure helper (tested): newest first, no duplicates. */
export function addFiles(existing: MediaItem[], items: MediaItem[]): { files: MediaItem[]; added: number } {
  const known = new Set(existing.map((f) => f.id));
  const fresh: MediaItem[] = [];
  for (const it of items) {
    if (it.type !== 'local' || known.has(it.id)) continue;
    known.add(it.id);
    fresh.push(slimItem(it));
  }
  return { files: [...fresh, ...existing], added: fresh.length };
}

export const useLocalFiles = create<LocalFilesState>()(
  persist(
    (set, get) => ({
      files: [],
      add: (items) => {
        const { files, added } = addFiles(get().files, items);
        if (added) set({ files });
        return added;
      },
      remove: (id) => set((s) => ({ files: s.files.filter((f) => f.id !== id) })),
      clear: () => set({ files: [] }),
    }),
    {
      name: 'wave-local-files',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ files }) => ({ files }),
    },
  ),
);
