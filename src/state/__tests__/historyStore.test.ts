/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import type { MediaItem } from '@/native';
import { addToHistory, dayLabel, groupByDay, HISTORY_LIMIT, HISTORY_MERGE_MS, type HistoryEntry } from '../historyStore';

const v = (id: string): MediaItem => ({
  type: 'video',
  id,
  title: `T ${id}`,
  channel: 'K',
  durationSec: 60,
  thumbnail: null,
  viewCount: 123,
  videoCount: null,
  url: `https://youtu.be/${id}`,
});

const T0 = new Date(2026, 9, 29, 12, 0).getTime();

test('newest entry first', () => {
  let h: HistoryEntry[] = [];
  h = addToHistory(h, v('a'), T0);
  h = addToHistory(h, v('b'), T0 + 1000);
  expect(h.map((e) => e.item.id)).toEqual(['b', 'a']);
});

test('replaying within the merge window moves the track up instead of duplicating', () => {
  let h: HistoryEntry[] = [];
  h = addToHistory(h, v('a'), T0);
  h = addToHistory(h, v('b'), T0 + 1000);
  h = addToHistory(h, v('a'), T0 + 2000);
  expect(h.map((e) => e.item.id)).toEqual(['a', 'b']);
  expect(h[0].playedAt).toBe(T0 + 2000);
});

test('replaying later adds a new entry', () => {
  let h: HistoryEntry[] = [];
  h = addToHistory(h, v('a'), T0);
  h = addToHistory(h, v('a'), T0 + HISTORY_MERGE_MS + 1);
  expect(h).toHaveLength(2);
  expect(new Set(h.map((e) => e.key)).size).toBe(2);
});

test('caps the history', () => {
  let h: HistoryEntry[] = [];
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = addToHistory(h, v(`id${i}`), T0 + i * HISTORY_MERGE_MS * 2);
  expect(h).toHaveLength(HISTORY_LIMIT);
  expect(h[0].item.id).toBe(`id${HISTORY_LIMIT + 19}`);
});

test('day labels and grouping', () => {
  expect(dayLabel(T0, T0, 'de')).toBe('Heute');
  expect(dayLabel(T0, T0, 'en')).toBe('Today');
  expect(dayLabel(T0 - 86_400_000, T0, 'de')).toBe('Gestern');
  const entries = [
    addToHistory([], v('a'), T0)[0],
    addToHistory([], v('b'), T0 - 3600_000)[0],
    addToHistory([], v('c'), T0 - 86_400_000)[0],
  ];
  const groups = groupByDay(entries, T0, 'de');
  expect(groups.map((g) => [g.title, g.data.length])).toEqual([
    ['Heute', 2],
    ['Gestern', 1],
  ]);
});
