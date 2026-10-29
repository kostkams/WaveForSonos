import { Native } from '@/native';
import { usePlayer } from '@/state/playerStore';
import { useSettings } from '@/state/settingsStore';
import { useSpeakers } from '@/state/speakerStore';
import { refreshRoomVolumes, setGroupVolume } from './speakers';

// Hardware volume keys → Sonos group volume.
// The native media session reports the target volume; we coalesce fast key repeats so only
// the latest value is sent while a request is in flight.

let pending: number | null = null;
let sending = false;
/** Time of the last key press; polling doesn't overwrite the volume right after one. */
export let lastKeyAt = 0;

async function flush() {
  if (sending) return;
  sending = true;
  try {
    while (pending !== null) {
      const v = pending;
      pending = null;
      await setGroupVolume(v);
    }
  } finally {
    sending = false;
  }
  // Sonos scales each room when the group volume changes – show the new room levels.
  if (roomTimer) clearTimeout(roomTimer);
  roomTimer = setTimeout(() => void refreshRoomVolumes(), 300);
}

let roomTimer: ReturnType<typeof setTimeout> | null = null;

export function handleVolumeKey(volume: number) {
  lastKeyAt = Date.now();
  useSpeakers.getState().set({ groupVolume: volume });
  pending = volume;
  void flush();
}

let lastSent: number | null = null;

/** Tells the native side which volume the keys should control (or -1 to release them). */
export function syncRemoteVolume() {
  const enabled = useSettings.getState().volumeKeys;
  const active = usePlayer.getState().index >= 0;
  const gv = useSpeakers.getState().groupVolume;
  const target = enabled && active && gv !== null ? gv : -1;
  if (target === lastSent) return;
  lastSent = target;
  try {
    Native.setRemoteVolume(target);
  } catch {
    lastSent = null;
  }
}

/** Forces the next sync to reach the native side (e.g. after the service was restarted). */
export function resetRemoteVolumeSync() {
  lastSent = null;
}

let wired = false;
export function initVolumeKeys() {
  if (wired) return;
  wired = true;
  Native.addListener('onVolumeKey', ({ volume }) => handleVolumeKey(volume));
  useSettings.subscribe(syncRemoteVolume);
  useSpeakers.subscribe(syncRemoteVolume);
  usePlayer.subscribe(syncRemoteVolume);
  syncRemoteVolume();
}
