/// <reference types="jest" />
jest.mock('@/native', () => ({
  Native: {
    setRemoteVolume: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../speakers', () => {
  let release: (() => void) | null = null;
  return {
    setGroupVolume: jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    ),
    refreshRoomVolumes: jest.fn(async () => undefined),
    __release: () => release?.(),
  };
});

import { Native } from '@/native';
import { usePlayer } from '@/state/playerStore';
import { useSettings } from '@/state/settingsStore';
import { useSpeakers } from '@/state/speakerStore';
import { handleVolumeKey, resetRemoteVolumeSync, syncRemoteVolume } from '../volumeKeys';

const speakers = jest.requireMock('../speakers') as { setGroupVolume: jest.Mock; __release: () => void };
const native = Native as unknown as { setRemoteVolume: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  resetRemoteVolumeSync();
  useSettings.setState({ volumeKeys: true });
  useSpeakers.setState({ groupVolume: 30 });
  usePlayer.setState({ index: 0 });
});

test('hands the Sonos volume to the keys only while something is loaded', () => {
  usePlayer.setState({ index: -1 });
  syncRemoteVolume();
  expect(native.setRemoteVolume).toHaveBeenLastCalledWith(-1);
  usePlayer.setState({ index: 0 });
  syncRemoteVolume();
  expect(native.setRemoteVolume).toHaveBeenLastCalledWith(30);
});

test('releases the keys when the setting is off', () => {
  syncRemoteVolume();
  useSettings.setState({ volumeKeys: false });
  syncRemoteVolume();
  expect(native.setRemoteVolume).toHaveBeenLastCalledWith(-1);
});

test('does not resend an unchanged value', () => {
  syncRemoteVolume();
  syncRemoteVolume();
  expect(native.setRemoteVolume).toHaveBeenCalledTimes(1);
});

test('coalesces fast key presses: only first and latest are sent', async () => {
  handleVolumeKey(32);
  handleVolumeKey(34);
  handleVolumeKey(36);
  expect(useSpeakers.getState().groupVolume).toBe(36);
  expect(speakers.setGroupVolume).toHaveBeenCalledTimes(1);
  expect(speakers.setGroupVolume).toHaveBeenLastCalledWith(32);
  speakers.__release();
  await Promise.resolve();
  await Promise.resolve();
  expect(speakers.setGroupVolume).toHaveBeenCalledTimes(2);
  expect(speakers.setGroupVolume).toHaveBeenLastCalledWith(36);
  speakers.__release();
});
