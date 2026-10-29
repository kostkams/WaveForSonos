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
  clearNextUri: jest.fn(async () => undefined),
  play: jest.fn(async () => undefined),
  pause: jest.fn(async () => undefined),
  stop: jest.fn(async () => undefined),
  seek: jest.fn(async () => undefined),
  getTransportInfo: jest.fn(async () => ({ state: 'PLAYING', status: 'OK' })),
  getPositionInfo: jest.fn(async () => ({ track: 1, uri: '', positionSec: 0, durationSec: 100, metadata: null })),
  getGroupVolume: jest.fn(async () => 20),
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

import { clearUpcoming, enqueue, move, moveToNewLead, playIndex, playNow, poll, removeAt, stopPolling, togglePlay } from '../controller';
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

const flush = () => new Promise((r) => setTimeout(r, 0));

/** What the fake speaker answers to GetTransportInfo / GetPositionInfo. */
function sonosReports(state: string, uri: string, positionSec: number | null = 10, durationSec: number | null = 100) {
  mockSonos.getTransportInfo.mockImplementation(async () => ({ state, status: 'OK' }));
  mockSonos.getPositionInfo.mockImplementation(async () => ({ track: 1, uri, positionSec, durationSec, metadata: null }));
}

/** URI of the n-th SetAVTransportURI call. */
const setUriArg = (n: number) => mockSonos.setUri.mock.calls[n][1] as string;

const ids = () => usePlayer.getState().queue.map((q) => q.id[0]);

beforeEach(() => {
  usePlayer.setState({ queue: [], index: -1, shuffle: false, repeat: false });
  useSettings.setState({ streamFormat: 'm4a', autoAdvance: true });
  jest.clearAllMocks();
  mockSonos.setUri.mockImplementation(async () => undefined);
  sonosReports('PLAYING', '');
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
  expect(mockSonos.setUri).toHaveBeenCalledWith(
    '10.0.0.40',
    expect.stringMatching(/^http:\/\/10\.0\.0\.5:8080\/stream\/cxxxxxxxxxx\.m4a\?q=[^&]+$/),
    '<DIDL-Lite/>',
  );
  expect(mockSonos.play).toHaveBeenCalled();
});

test('compatibility mode uses the aac route with a start offset', async () => {
  useSettings.setState({ streamFormat: 'aac' });
  enqueue([video('a')]);
  await playIndex(0, 42);
  expect(mockSonos.setUri).toHaveBeenCalledWith(
    '10.0.0.40',
    expect.stringMatching(/^http:\/\/10\.0\.0\.5:8080\/stream\/axxxxxxxxxx\.aac\?q=[^&]+&start=42$/),
    expect.any(String),
  );
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

test('a poll while a new track is being started does not count as track end', async () => {
  enqueue([video('a'), video('b'), video('c')]);
  await playIndex(0);
  sonosReports('PLAYING', setUriArg(0));
  await poll();
  let release!: () => void;
  mockSonos.setUri.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
  const p = playIndex(1);
  sonosReports('STOPPED', setUriArg(0));
  await flush();
  await poll();
  release();
  await p;
  sonosReports('STOPPED', setUriArg(1));
  await poll(); // still loading: first state after the start is no end either
  expect(usePlayer.getState().index).toBe(1);
  expect(mockSonos.setUri).toHaveBeenCalledTimes(2);
});

test('a superseded playIndex does not finish', async () => {
  enqueue([video('a'), video('b'), video('c')]);
  let release!: () => void;
  mockSonos.setUri.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
  const p1 = playIndex(1);
  await flush();
  const p2 = playIndex(2);
  await p2;
  release();
  await p1;
  expect(usePlayer.getState().index).toBe(2);
  expect(usePlayer.getState().busy).toBe(false);
  expect(mockSonos.play).toHaveBeenCalledTimes(1);
});

test('foreign playback stopping does not auto-advance', async () => {
  enqueue([video('a'), video('b')]);
  await playIndex(0);
  sonosReports('PLAYING', 'x-sonos-spotify:track');
  await poll();
  expect(usePlayer.getState().foreign).toBe(true);
  sonosReports('STOPPED', 'x-sonos-spotify:track');
  await poll();
  expect(mockSonos.setUri).toHaveBeenCalledTimes(1);
  expect(usePlayer.getState().index).toBe(0);
});

test('the Sonos next slot is emptied when nothing follows any more', async () => {
  enqueue([video('a'), video('b')]);
  await playIndex(0);
  await flush();
  expect(mockSonos.setNextUri).toHaveBeenCalledWith('10.0.0.40', expect.stringContaining('/stream/bxxxxxxxxxx.m4a'), expect.any(String));
  removeAt(1);
  await flush();
  expect(mockSonos.clearNextUri).toHaveBeenCalledTimes(1);
  enqueue([video('c')]);
  await flush();
  clearUpcoming();
  await flush();
  expect(mockSonos.clearNextUri).toHaveBeenCalledTimes(2);
  removeAt(5); // no-op, nothing queued: no extra SOAP call
  clearUpcoming();
  await flush();
  expect(mockSonos.clearNextUri).toHaveBeenCalledTimes(2);
});

test('removing the playing track plays the following one', async () => {
  enqueue([video('a'), video('b'), video('c')]);
  await playIndex(1);
  removeAt(1);
  await flush();
  expect(ids()).toEqual(['a', 'c']);
  expect(usePlayer.getState().index).toBe(1);
  expect(setUriArg(1)).toContain('/stream/cxxxxxxxxxx.m4a');
});

test('removing the paused track stops the speaker', async () => {
  enqueue([video('a'), video('b')]);
  await playIndex(0);
  usePlayer.setState({ transport: 'PAUSED_PLAYBACK' });
  removeAt(0);
  await flush();
  expect(mockSonos.stop).toHaveBeenCalled();
  expect(usePlayer.getState()).toMatchObject({ index: 0, transport: 'STOPPED', positionSec: 0 });
  expect(mockSonos.setUri).toHaveBeenCalledTimes(1);
});

test('compatibility mode adds the stream start offset to the reported position', async () => {
  useSettings.setState({ streamFormat: 'aac' });
  enqueue([video('a')]);
  await playIndex(0, 42);
  sonosReports('PLAYING', setUriArg(0), 3);
  await poll();
  expect(usePlayer.getState().positionSec).toBe(45);
});

test('a reported duration of 0 keeps the known duration', async () => {
  enqueue([video('a')]);
  await playIndex(0);
  sonosReports('PLAYING', setUriArg(0), 3, 0);
  await poll();
  expect(usePlayer.getState().durationSec).toBe(100);
});

test('gapless advance is detected for the same video queued twice', async () => {
  enqueue([video('a'), video('a')]);
  await playIndex(0);
  await flush();
  const nextUri = mockSonos.setNextUri.mock.calls[0][1] as string;
  expect(nextUri).not.toBe(setUriArg(0));
  sonosReports('PLAYING', nextUri);
  await poll();
  expect(usePlayer.getState().index).toBe(1);
});

test('resuming outside the app re-enables auto-advance', async () => {
  enqueue([video('a'), video('b')]);
  await playIndex(0);
  await togglePlay(); // user pauses
  sonosReports('PLAYING', setUriArg(0)); // resumed in the Sonos app
  await poll();
  sonosReports('STOPPED', setUriArg(0));
  await poll();
  expect(usePlayer.getState().index).toBe(1);
  expect(setUriArg(1)).toContain('/stream/bxxxxxxxxxx.m4a');
});

test('deselecting the lead room stops it and continues on the new lead', async () => {
  enqueue([video('a')]);
  await playIndex(0);
  usePlayer.setState({ positionSec: 30 });
  await moveToNewLead('10.0.0.41');
  expect(mockSonos.stop).toHaveBeenCalledWith('10.0.0.41');
  expect(mockSonos.setUri).toHaveBeenCalledTimes(2);
  expect(mockSonos.seek).toHaveBeenCalledWith('10.0.0.40', 30);
});
