import { t, type TranslationKey } from '@/i18n';
import { Native } from '@/native';
import * as sonos from '@/sonos';
import { useSettings } from '@/state/settingsStore';
import { allSpeakers, groupOf, speakerByUuid, useSpeakers } from '@/state/speakerStore';

const store = () => useSpeakers.getState();

let discovery: Promise<void> | null = null;

/** Finds Sonos speakers via SSDP and loads the zone topology. Concurrent calls share one run. */
export function discover(): Promise<void> {
  if (!discovery) {
    discovery = doDiscover().finally(() => {
      discovery = null;
    });
  }
  return discovery;
}

/** Per-speaker timeout while probing candidates; a stale IP must not stall discovery. */
const PROBE_TIMEOUT_MS = 2500;

async function doDiscover(): Promise<void> {
  store().set({ discovering: true, error: null });
  try {
    const tried = new Set<string>();
    // 1. SSDP (multicast + broadcast), plus the speakers we knew last time.
    const found = await Native.discoverSonos(3000).catch(() => []);
    const known = useSettings.getState().knownSpeakerIps;
    let result = await firstTopology([store().seedIp, ...found.map((f) => f.ip), ...known], tried);
    // 2. The network drops SSDP (common with mesh Wi-Fi / IGMP snooping): probe the subnet on port 1400.
    if (!result) {
      const open = await Native.scanSonosSubnet(500).catch(() => []);
      result = await firstTopology(open, tried);
    }
    if (!result) {
      store().set({ groups: [], error: t('speakers.errNotFound') });
      return;
    }
    const { groups, ip: seedIp } = result;
    store().set({ groups, seedIp });
    useSettings.getState().set({ knownSpeakerIps: speakerIps(groups) });
    initSelection(groups);
    await refreshVolumes();
  } catch (e) {
    store().set({ error: errorText(e) });
  } finally {
    store().set({ discovering: false });
  }
}

/** Asks the candidates for the zone topology, a few at a time; first speaker with rooms wins. */
async function firstTopology(
  candidates: (string | null | undefined)[],
  tried: Set<string>,
): Promise<{ groups: sonos.ZoneGroup[]; ip: string } | null> {
  const ips = [...new Set(candidates.filter((ip): ip is string => !!ip && !tried.has(ip)))];
  for (let i = 0; i < ips.length; i += 4) {
    const batch = ips.slice(i, i + 4);
    batch.forEach((ip) => tried.add(ip));
    const results = await Promise.all(
      batch.map(async (ip) => {
        try {
          const groups = await sonos.getZoneGroups(ip, PROBE_TIMEOUT_MS);
          return groups.some((g) => g.members.length > 0) ? { groups, ip } : null;
        } catch {
          return null;
        }
      }),
    );
    const hit = results.find((r) => r !== null);
    if (hit) return hit;
  }
  return null;
}

function speakerIps(groups: sonos.ZoneGroup[]): string[] {
  return [...new Set(groups.flatMap((g) => g.members.map((m) => m.ip)).filter(Boolean))];
}

/** Reloads the topology from the known seed speaker. */
export async function refreshTopology(): Promise<void> {
  const ip = store().seedIp;
  if (!ip) return discover();
  try {
    const groups = await sonos.getZoneGroups(ip);
    const known = new Set(allSpeakers(groups).map((s) => s.uuid));
    store().set({ groups, selected: store().selected.filter((u) => known.has(u)) });
  } catch {
    await discover();
  }
}

function initSelection(groups: sonos.ZoneGroup[]) {
  const known = new Set(allSpeakers(groups).map((s) => s.uuid));
  const current = store().selected.filter((u) => known.has(u));
  if (current.length) {
    store().set({ selected: current });
    return;
  }
  const defaults = useSettings.getState().defaultRooms.filter((u) => known.has(u));
  if (defaults.length) {
    store().set({ selected: defaults });
    return;
  }
  // Fall back to the first group as it is right now.
  const first = groups.find((g) => g.members.length > 0);
  if (first) store().set({ selected: [first.coordinatorUuid, ...first.members.filter((m) => m.uuid !== first.coordinatorUuid).map((m) => m.uuid)] });
}

/** IP of the speaker that should receive transport commands, after making sure the group matches the selection. */
export async function ensureTargetIp(): Promise<string> {
  if (!store().groups.length) await discover();
  const { selected } = store();
  if (!selected.length) throw new Error(t('speakers.errChooseFirst'));
  await applyGrouping();
  const lead = speakerByUuid(store().groups, selected[0]);
  if (!lead) throw new Error(t('speakers.errUnreachable'));
  return lead.ip;
}

/** Coordinator IP of the current selection without changing anything (for polling). */
export function currentTargetIp(): string | null {
  const { groups, selected } = store();
  if (!selected.length) return null;
  const g = groupOf(groups, selected[0]);
  return g?.coordinatorIp ?? speakerByUuid(groups, selected[0])?.ip ?? null;
}

let applying: Promise<void> | null = null;

/** Makes the Sonos grouping match the selection: first selected room leads, the others join it. */
export function applyGrouping(): Promise<void> {
  applying = (applying ?? Promise.resolve()).then(doApplyGrouping, doApplyGrouping);
  return applying;
}

async function doApplyGrouping(): Promise<void> {
  let { groups } = store();
  const { selected } = store();
  if (!selected.length) return;
  const leadUuid = selected[0];
  const lead = speakerByUuid(groups, leadUuid);
  if (!lead) return;
  let changed = false;

  const leadGroup = groupOf(groups, leadUuid);
  if (leadGroup && leadGroup.coordinatorUuid !== leadUuid) {
    await sonos.leaveGroup(lead.ip);
    changed = true;
    // The lead now coordinates its own group; continue from the real topology.
    await refreshTopology();
    groups = store().groups;
  }
  for (const uuid of selected.slice(1)) {
    const sp = speakerByUuid(groups, uuid);
    if (!sp) continue;
    if (groupOf(groups, uuid)?.coordinatorUuid !== leadUuid) {
      await sonos.joinGroup(sp.ip, leadUuid);
      changed = true;
    }
  }
  const inLeadGroup = groupOf(groups, leadUuid)?.coordinatorUuid === leadUuid ? groupOf(groups, leadUuid)!.members : [];
  for (const m of inLeadGroup) {
    if (m.uuid !== leadUuid && !selected.includes(m.uuid)) {
      await sonos.leaveGroup(m.ip);
      changed = true;
    }
  }
  if (changed) await refreshTopology();
}

type LeadChangeHandler = (oldLeadIp: string) => Promise<void> | void;
let leadChangeHandler: LeadChangeHandler | null = null;

/** Called after the leading room was deselected and the group moved to a new lead (the controller carries playback over). */
export function onLeadChange(handler: LeadChangeHandler | null) {
  leadChangeHandler = handler;
}

export async function toggleRoom(uuid: string): Promise<void> {
  const { selected } = store();
  const next = selected.includes(uuid) ? selected.filter((u) => u !== uuid) : [...selected, uuid];
  // Deselecting the leading room: its group's playback has to move to the new lead.
  const oldLeadIp = selected[0] === uuid && next.length > 0 ? currentTargetIp() : null;
  store().set({ selected: next, error: null });
  try {
    if (next.length === 0) {
      // Nothing selected: release the room we just removed.
      const sp = speakerByUuid(store().groups, uuid);
      const g = groupOf(store().groups, uuid);
      if (sp && g && g.members.length > 1) await sonos.leaveGroup(sp.ip);
      await refreshTopology();
      return;
    }
    await applyGrouping();
    const newLeadIp = currentTargetIp();
    if (oldLeadIp && newLeadIp && newLeadIp !== oldLeadIp) await leadChangeHandler?.(oldLeadIp);
    await refreshVolumes();
  } catch (e) {
    store().set({ error: errorText(e) });
  }
}

/** Last time a room slider was moved; refreshes don't overwrite it right after. */
let lastRoomEditAt = 0;

/** Reloads the per-room volumes (they change when the group volume changes). */
export async function refreshRoomVolumes(): Promise<void> {
  if (Date.now() - lastRoomEditAt < 2000) return;
  const speakers = allSpeakers(store().groups);
  const fetched: Record<string, number> = {};
  await Promise.all(
    speakers.map(async (s) => {
      try {
        fetched[s.uuid] = await sonos.getVolume(s.ip);
      } catch {
        // speaker may be asleep / unreachable
      }
    }),
  );
  if (Date.now() - lastRoomEditAt < 2000) return;
  const current = store().volumes;
  const changed = Object.keys(fetched).some((k) => current[k] !== fetched[k]);
  if (changed) store().set({ volumes: { ...current, ...fetched } });
}

export async function refreshVolumes(): Promise<void> {
  await refreshRoomVolumes();
  let groupVolume: number | null = null;
  const ip = currentTargetIp();
  if (ip) {
    try {
      groupVolume = await sonos.getGroupVolume(ip);
    } catch {
      groupVolume = null;
    }
  }
  store().set({ groupVolume });
}

export async function setRoomVolume(uuid: string, volume: number): Promise<void> {
  const sp = speakerByUuid(store().groups, uuid);
  if (!sp) return;
  const v = Math.round(volume);
  lastRoomEditAt = Date.now();
  store().set({ volumes: { ...store().volumes, [uuid]: v } });
  try {
    await sonos.setVolume(sp.ip, v);
  } catch (e) {
    store().set({ error: errorText(e) });
  }
}

export async function setGroupVolume(volume: number): Promise<void> {
  const ip = currentTargetIp();
  if (!ip) return;
  const v = Math.round(volume);
  store().set({ groupVolume: v });
  try {
    await sonos.setGroupVolume(ip, v);
  } catch (e) {
    store().set({ error: errorText(e) });
  }
}

/** Native error codes (see YouTubeRepository.mapError) with a message the user can act on. */
const CODE_TEXT: Record<string, TranslationKey> = {
  ERR_NO_AUDIO_STREAM: 'error.noAudio',
  ERR_YOUTUBE_AGE_RESTRICTED: 'error.ageRestricted',
  ERR_YOUTUBE_GEO_RESTRICTED: 'error.geoRestricted',
  ERR_YOUTUBE_UNAVAILABLE: 'error.unavailable',
  ERR_YOUTUBE_BOT_CHECK: 'error.botCheck',
  ERR_YOUTUBE_RECAPTCHA: 'error.botCheck',
};

export function errorText(e: unknown): string {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(CODE_TEXT, code)) return t(CODE_TEXT[code]);
  if (e instanceof Error) return e.message;
  return String(e);
}
