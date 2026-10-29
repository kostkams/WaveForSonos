/// <reference types="jest" />
import type { MediaItem } from '@/native';

jest.mock('@/native', () => ({
  Native: {
    startProxy: jest.fn(async () => ({ baseUrl: 'http://10.0.0.5:8080', port: 8080 })),
    stopProxy: jest.fn(async () => undefined),
    updateNowPlaying: jest.fn(),
    discoverSonos: jest.fn(async () => []),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@/sonos', () => ({
  setUri: jest.fn(async () => undefined),
  setNextUri: jest.fn(async () => undefined),
  play: jest.fn(async () => undefined),
  pause: jest.fn(async () => undefined),
  seek: jest.fn(async () => undefined),
  getTransportInfo: jest.fn(async () => ({ state: 'PLAYING', status: 'OK' })),
  buildDidl: jest.fn(() => '<DIDL-Lite/>'),
}));

jest.mock('../speakers', () => ({
  ensureTargetIp: jest.fn(async () => '10.0.0.40'),
  currentTargetIp: jest.fn(() => '10.0.0.40'),
  errorText: (e: unknown) => String(e),
  refreshVolumes: jest.fn(async () => undefined),
}));

jest.mock('../volumeKeys', () => ({
  initVolumeKeys: jest.fn(),
  resetRemoteVolumeSync: jest.fn(),
  lastKeyAt: 0,
}));

import { clearUpcoming, enqueue, move, playIndex, playNow, removeAt, stopPolling } from '../controller';
import { usePlayer } from '@/state/playerStore';
import { useSettings } from '@/state/settingsStore';

const mockSonos = jest.requireMock('@/sonos') as Record<string, jest.Mock>;

const video = (id: string): MediaItem => ({
  type: 'video',
  id: id.padEnd(11, 'x'),
  title: `Titel ${id}`,
  channel: 'Kanal',
  durationSec: 100,
  thumbnail: null,
  viewCount: null,
  videoCount: null,
  url: `https://youtu.be/${id}`,
});

const ids = () => usePlayer.getState().queue.map((q) => q.id[0]);

beforeEach(() => {
  usePlayer.setState({ queue: [], index: -1, shuffle: false, repeat: false });
  useSettings.setState({ streamFormat: 'm4a', autoAdvance: true });
  jest.clearAllMocks();
});
afterEach(() => stopPolling());

test('enqueue skips playlists and appends videos', () => {
  const n = enqueue([video('a'), { ...video('p'), type: 'playlist' }, video('b')]);
  expect(n).toBe(2);
  expect(ids()).toEqual(['a', 'b']);
});

test('playNow inserts after the current track and plays it via the proxy', async () => {
  enqueue([video('a'), video('b')]);
  usePlayer.setState({ index: 0 });
  await playNow([video('c')]);
  expect(ids()).toEqual(['a', 'c', 'b']);
  expect(usePlayer.getState().index).toBe(1);
  expect(usePlayer.getState().error).toBeNull();
  expect(mockSonos.setUri).toHaveBeenCalledWith('10.0.0.40', 'http://10.0.0.5:8080/stream/cxxxxxxxxxx.m4a', '<DIDL-Lite/>');
  expect(mockSonos.play).toHaveBeenCalled();
});

test('compatibility mode uses the aac route with a start offset', async () => {
  useSettings.setState({ streamFormat: 'aac' });
  enqueue([video('a')]);
  await playIndex(0, 42);
  expect(mockSonos.setUri).toHaveBeenCalledWith('10.0.0.40', 'http://10.0.0.5:8080/stream/axxxxxxxxxx.aac?start=42', expect.any(String));
  expect(mockSonos.seek).not.toHaveBeenCalled();
});

test('move keeps the current track index in sync', () => {
  enqueue([video('a'), video('b'), video('c'), video('d')]);
  usePlayer.setState({ index: 1 }); // b playing
  move(3, 2); // d before c
  expect(ids()).toEqual(['a', 'b', 'd', 'c']);
  expect(usePlayer.getState().index).toBe(1);
  move(1, 3); // move the playing track
  expect(ids()).toEqual(['a', 'd', 'c', 'b']);
  expect(usePlayer.getState().index).toBe(3);
  move(0, 3);
  expect(usePlayer.getState().index).toBe(2);
});

test('removeAt before the current track shifts the index', () => {
  enqueue([video('a'), video('b'), video('c')]);
  usePlayer.setState({ index: 2 });
  removeAt(0);
  expect(ids()).toEqual(['b', 'c']);
  expect(usePlayer.getState().index).toBe(1);
});

test('clearUpcoming keeps only the current track', () => {
  enqueue([video('a'), video('b'), video('c')]);
  usePlayer.setState({ index: 1 });
  clearUpcoming();
  expect(ids()).toEqual(['b']);
  expect(usePlayer.getState().index).toBe(0);
});
