import { soapCall } from './soap';

const clampVolume = (v: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(v) ? v : 0)));
const toInt = (s: string | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

const rc = (ip: string, action: string, args: Record<string, string | number> = {}) =>
  soapCall(ip, 'RenderingControl', action, { InstanceID: 0, Channel: 'Master', ...args });

const grc = (ip: string, action: string, args: Record<string, string | number> = {}) =>
  soapCall(ip, 'GroupRenderingControl', action, { InstanceID: 0, ...args });

/** Volume of a single player (0-100). */
export async function getVolume(ip: string): Promise<number> {
  const r = await rc(ip, 'GetVolume');
  return toInt(r.CurrentVolume);
}

export async function setVolume(ip: string, volume: number): Promise<void> {
  await rc(ip, 'SetVolume', { DesiredVolume: clampVolume(volume) });
}

export async function getMute(ip: string): Promise<boolean> {
  const r = await rc(ip, 'GetMute');
  return r.CurrentMute === '1';
}

export async function setMute(ip: string, mute: boolean): Promise<void> {
  await rc(ip, 'SetMute', { DesiredMute: mute ? 1 : 0 });
}

/** Group volume — must be sent to the group coordinator. */
export async function getGroupVolume(coordinatorIp: string): Promise<number> {
  const r = await grc(coordinatorIp, 'GetGroupVolume');
  return toInt(r.CurrentVolume);
}

/**
 * Set group volume on the coordinator. SnapshotGroupVolume is called first so the
 * relative volume ratios between members are captured from their current levels.
 */
export async function setGroupVolume(coordinatorIp: string, volume: number): Promise<void> {
  await grc(coordinatorIp, 'SnapshotGroupVolume');
  await grc(coordinatorIp, 'SetGroupVolume', { DesiredVolume: clampVolume(volume) });
}

export async function getGroupMute(coordinatorIp: string): Promise<boolean> {
  const r = await grc(coordinatorIp, 'GetGroupMute');
  return r.CurrentMute === '1';
}

export async function setGroupMute(coordinatorIp: string, mute: boolean): Promise<void> {
  await grc(coordinatorIp, 'SetGroupMute', { DesiredMute: mute ? 1 : 0 });
}
