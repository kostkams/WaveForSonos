/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import type { MediaItem } from '@/native';
import { addFiles } from '../localFilesStore';
import { mergeItems } from '../playlistStore';
import { localArtName } from '@/util/media';

const local = (id: string, ext = 'mp3'): MediaItem => ({
  type: 'local',
  id,
  title: `Song ${id}`,
  channel: 'Band',
  durationSec: 200,
  thumbnail: null,
  viewCount: null,
  videoCount: null,
  url: `content://media/${id}`,
  ext,
  sizeBytes: 1234,
});

test('addFiles puts new files first and skips duplicates and non-local items', () => {
  const first = addFiles([], [local('a'), local('b')]);
  const { files, added } = addFiles(first.files, [local('b'), local('c'), { ...local('v'), type: 'video' }]);
  expect(added).toBe(1);
  expect(files.map((f) => f.id)).toEqual(['c', 'a', 'b']);
  expect(files[0].ext).toBe('mp3');
  expect(files[0]).not.toHaveProperty('sizeBytes');
});

test('local files can go into playlists and keep their extension', () => {
  const { items, added } = mergeItems([], [local('x', 'flac')]);
  expect(added).toBe(1);
  expect(items[0]).toMatchObject({ type: 'local', ext: 'flac' });
});

test('localArtName', () => {
  const sha = 'a'.repeat(40);
  expect(localArtName(`file:///data/user/0/app/files/local-art/${sha}.jpg`)).toBe(`${sha}.jpg`);
  expect(localArtName('https://i.ytimg.com/vi/x/hq.jpg')).toBeNull();
  expect(localArtName(null)).toBeNull();
});
