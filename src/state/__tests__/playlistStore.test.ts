/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import type { MediaItem } from '@/native';
import { mergeItems, moveItem, shuffled, uniqueName, usePlaylists, type UserPlaylist } from '../playlistStore';

const v = (id: string, type: MediaItem['type'] = 'video'): MediaItem => ({
  type,
  id,
  title: `T ${id}`,
  channel: 'K',
  durationSec: 60,
  thumbnail: null,
  viewCount: 999,
  videoCount: null,
  url: `https://youtu.be/${id}`,
});

beforeEach(() => usePlaylists.setState({ playlists: [] }));

test('mergeItems skips duplicates and playlists', () => {
  const { items, added } = mergeItems([v('a')], [v('a'), v('b'), v('p', 'playlist'), v('b')]);
  expect(items.map((i) => i.id)).toEqual(['a', 'b']);
  expect(added).toBe(1);
  expect(items[1].viewCount).toBeNull();
});

test('moveItem', () => {
  expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  expect(moveItem(['a'], 0, 5)).toEqual(['a']);
});

test('uniqueName', () => {
  const pls = [{ name: 'Party' }, { name: 'party 2' }] as UserPlaylist[];
  expect(uniqueName(pls, 'Party')).toBe('Party 3');
  expect(uniqueName(pls, 'Chill')).toBe('Chill');
});

test('create, add, move, remove, rename, delete', () => {
  const s = () => usePlaylists.getState();
  const id = s().create('  Sonntag ', [v('a')]);
  expect(s().playlists[0]).toMatchObject({ id, name: 'Sonntag' });
  expect(s().addItems(id, [v('a'), v('b'), v('c')])).toBe(2);
  s().move(id, 2, 0);
  expect(s().playlists[0].items.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  s().removeAt(id, 1);
  expect(s().playlists[0].items.map((i) => i.id)).toEqual(['c', 'b']);
  s().rename(id, 'Sonntagmorgen');
  s().rename(id, '   ');
  expect(s().playlists[0].name).toBe('Sonntagmorgen');
  s().remove(id);
  expect(s().playlists).toHaveLength(0);
});

test('shuffled keeps all items', () => {
  const out = shuffled([1, 2, 3, 4, 5]);
  expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
});
