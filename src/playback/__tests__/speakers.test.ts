/// <reference types="jest" />

jest.mock('@/native', () => ({
  Native: {
    discoverSonos: jest.fn(async () => [{ ip: '10.0.0.1' }]),
    scanSonosSubnet: jest.fn(async () => [] as string[]),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/** Tiny fake Sonos household: uuid → uuid of its coordinator. */
const mockTopo: Record<string, string> = {};
const mockIp = (uuid: string) => `10.0.0.${uuid.charCodeAt(0) - 64}`;
/** Speakers answer unless a test takes them offline. */
let mockReachable = (_ip: string) => true;
const mockUuid = (ip: string) => String.fromCharCode(Number(ip.split('.')[3]) + 64);

jest.mock('@/sonos', () => ({
  getZoneGroups: jest.fn(async (ip: string) => {
    if (!mockReachable(ip)) throw new Error('unreachable');
    const coords = [...new Set(Object.values(mockTopo))];
    return coords.map((c) => ({
      id: c,
      coordinatorUuid: c,
      coordinatorIp: mockIp(c),
      members: Object.keys(mockTopo)
        .filter((u) => mockTopo[u] === c)
        .map((u) => ({ uuid: u, name: u, ip: mockIp(u), location: '', isCoordinator: u === c, invisible: false })),
    }));
  }),
  leaveGroup: jest.fn(async (ip: string) => {
    const u = mockUuid(ip);
    const rest = Object.keys(mockTopo).filter((m) => m !== u && mockTopo[m] === u);
    for (const m of rest) mockTopo[m] = rest[0];
    mockTopo[u] = u;
  }),
  joinGroup: jest.fn(async (ip: string, coord: string) => {
    mockTopo[mockUuid(ip)] = coord;
  }),
  getVolume: jest.fn(async () => 20),
  getGroupVolume: jest.fn(async () => 20),
}));

import { discover, ensureTargetIp, errorText, onLeadChange, toggleRoom } from '../speakers';
import { useSettings } from '@/state/settingsStore';
import { groupOf, useSpeakers } from '@/state/speakerStore';

const mockNative = (jest.requireMock('@/native') as { Native: Record<string, jest.Mock> }).Native;

beforeEach(() => {
  for (const k of Object.keys(mockTopo)) delete mockTopo[k];
  Object.assign(mockTopo, { A: 'A', B: 'A', C: 'A' });
  useSpeakers.setState({ groups: [], selected: [], seedIp: null, discovering: false, error: null });
  useSettings.setState({ knownSpeakerIps: [] });
  mockReachable = () => true;
  jest.clearAllMocks();
});

test('ensureTargetIp waits for a discovery that is already running', async () => {
  const first = discover();
  const ip = await ensureTargetIp();
  await first;
  expect(ip).toBe('10.0.0.1');
  expect(mockNative.discoverSonos).toHaveBeenCalledTimes(1);
});

test('deselecting the lead moves the group to the next room and releases the old lead', async () => {
  await discover();
  expect(useSpeakers.getState().selected).toEqual(['A', 'B', 'C']);
  const handler = jest.fn();
  onLeadChange(handler);
  await toggleRoom('A');
  const { groups } = useSpeakers.getState();
  expect(groupOf(groups, 'B')?.coordinatorUuid).toBe('B');
  expect(groupOf(groups, 'C')?.coordinatorUuid).toBe('B');
  expect(groupOf(groups, 'A')?.members.map((m) => m.uuid)).toEqual(['A']);
  expect(handler).toHaveBeenCalledWith('10.0.0.1');
  onLeadChange(null);
});

test('errorText translates known native error codes and keeps other messages', () => {
  const coded = (code: string) => Object.assign(new Error('raw native message'), { code });
  useSettings.setState({ language: 'de' });
  expect(errorText(coded('ERR_NO_AUDIO_STREAM'))).toBe('Für dieses Video ist kein abspielbarer Ton verfügbar.');
  useSettings.setState({ language: 'en' });
  expect(errorText(coded('ERR_NO_AUDIO_STREAM'))).toBe('No playable audio is available for this video.');
  expect(errorText(coded('ERR_NETWORK'))).toBe('raw native message');
  expect(errorText(coded('toString'))).toBe('raw native message');
  expect(errorText('plain')).toBe('plain');
});

describe('discovery fallbacks', () => {
  test('remembers the speaker IPs after a successful discovery', async () => {
    await discover();
    expect(useSettings.getState().knownSpeakerIps.sort()).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
  });

  test('probes the remembered IPs when SSDP finds nothing', async () => {
    mockNative.discoverSonos.mockResolvedValueOnce([]);
    useSettings.setState({ knownSpeakerIps: ['10.0.0.9', '10.0.0.2'] });
    mockReachable = (ip) => ip !== '10.0.0.9';
    await discover();
    const s = useSpeakers.getState();
    expect(s.error).toBeNull();
    expect(s.seedIp).toBe('10.0.0.2');
    expect(mockNative.scanSonosSubnet).not.toHaveBeenCalled();
  });

  test('scans the subnet when SSDP and the remembered IPs fail', async () => {
    mockNative.discoverSonos.mockRejectedValueOnce(new Error('ERR_SSDP'));
    mockNative.scanSonosSubnet.mockResolvedValueOnce(['10.0.0.200', '10.0.0.3']);
    mockReachable = (ip) => ip === '10.0.0.3';
    await discover();
    const s = useSpeakers.getState();
    expect(s.error).toBeNull();
    expect(s.seedIp).toBe('10.0.0.3');
    expect(s.groups.length).toBeGreaterThan(0);
  });

  test('reports not found when nothing answers', async () => {
    mockNative.discoverSonos.mockResolvedValueOnce([]);
    mockReachable = () => false;
    await discover();
    expect(useSpeakers.getState().groups).toEqual([]);
    expect(useSpeakers.getState().error).toBeTruthy();
  });
});
