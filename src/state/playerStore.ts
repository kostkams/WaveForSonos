import { create } from 'zustand';

import type { MediaItem } from '@/native';

export type QueueItem = MediaItem & { key: string };
export type TransportState = 'PLAYING' | 'PAUSED_PLAYBACK' | 'STOPPED' | 'TRANSITIONING' | 'NO_MEDIA_PRESENT' | 'UNKNOWN';

type PlayerState = {
  queue: QueueItem[];
  /** Index of the current track in `queue`, -1 when nothing is loaded */
  index: number;
  shuffle: boolean;
  repeat: boolean;
  transport: TransportState;
  positionSec: number;
  durationSec: number | null;
  /** True while Sonos plays something that did not come from this app */
  foreign: boolean;
  busy: boolean;
  error: string | null;
  set: (patch: Partial<Omit<PlayerState, 'set'>>) => void;
};

let keySeq = 0;
export const toQueueItem = (m: MediaItem): QueueItem => ({ ...m, key: `${m.id}-${Date.now()}-${keySeq++}` });

export const usePlayer = create<PlayerState>()((set) => ({
  queue: [],
  index: -1,
  shuffle: false,
  repeat: false,
  transport: 'UNKNOWN',
  positionSec: 0,
  durationSec: null,
  foreign: false,
  busy: false,
  error: null,
  set: (patch) => set(patch),
}));

export const currentItem = (s: { queue: QueueItem[]; index: number }) =>
  s.index >= 0 && s.index < s.queue.length ? s.queue[s.index] : null;
