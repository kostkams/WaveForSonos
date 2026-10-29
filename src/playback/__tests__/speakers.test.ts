/// <reference types="jest" />

jest.mock('@/native', () => ({
  Native: { discoverSonos: jest.fn(async () => [{ ip: '10.0.0.1' }]) },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/** Tiny fake Sonos household: uuid → uuid of its coordinator. */
const mockTopo: Record<string, string> = {};
const mockIp = (uuid: string) => `10.0.0.${uuid.charCodeAt(0) - 64}`;
const mockUuid = (ip: string) => String.fromCharCode(Number(ip.split('.')[3]) + 64);

jest.mock('@/sonos', () => ({
  getZoneGroups: jest.fn(async () => {
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

import { discover, ensureTargetIp, onLeadChange, toggleRoom } from '../speakers';
import { groupOf, useSpeakers } from '@/state/speakerStore';

const mockNative = (jest.requireMock('@/native') as { Native: Record<string, jest.Mock> }).Native;

beforeEach(() => {
  for (const k of Object.keys(mockTopo)) delete mockTopo[k];
  Object.assign(mockTopo, { A: 'A', B: 'A', C: 'A' });
  useSpeakers.setState({ groups: [], selected: [], seedIp: null, discovering: false, error: null });
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
