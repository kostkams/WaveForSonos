import { soapCall } from './soap';
import { asArray, xmlParser } from './xml';

export interface SonosSpeaker {
  uuid: string;
  /** Room name (ZoneName). */
  name: string;
  ip: string;
  /** Device description URL, e.g. http://192.168.1.10:1400/xml/device_description.xml */
  location: string;
  isCoordinator: boolean;
  invisible: boolean;
}

export interface ZoneGroup {
  id: string;
  coordinatorUuid: string;
  coordinatorIp: string;
  /** Visible, playable members (coordinator first). */
  members: SonosSpeaker[];
}

/** Extract the host from a Location URL ("http://192.168.1.10:1400/xml/..." → "192.168.1.10"). */
export function ipFromLocation(location: string): string {
  const m = /^\s*https?:\/\/(\[[^\]]+\]|[^/:]+)/i.exec(location);
  return m ? m[1] : '';
}

/**
 * Parse the (already entity-decoded) ZoneGroupState XML. Supports both the old
 * `<ZoneGroups>` root and the newer `<ZoneGroupState><ZoneGroups>…` wrapper.
 * Invisible members (bonded stereo partner, surrounds, sub), satellites and
 * zone bridges (BOOST/Bridge) are dropped; groups without visible members are omitted.
 */
export function parseZoneGroupState(xml: string): ZoneGroup[] {
  if (!xml || !xml.trim()) return [];
  const doc: any = xmlParser.parse(xml);
  const zoneGroups = doc?.ZoneGroupState?.ZoneGroups ?? doc?.ZoneGroups;
  if (!zoneGroups || typeof zoneGroups !== 'object') return [];

  const groups: ZoneGroup[] = [];
  for (const g of asArray<any>(zoneGroups.ZoneGroup)) {
    if (!g || typeof g !== 'object') continue;
    const coordinatorUuid: string = g['@_Coordinator'] ?? '';
    const id: string = g['@_ID'] ?? coordinatorUuid;
    const rawMembers = asArray<any>(g.ZoneGroupMember).filter((m) => m && typeof m === 'object');

    const all: SonosSpeaker[] = rawMembers.map((m) => {
      const location: string = m['@_Location'] ?? '';
      const uuid: string = m['@_UUID'] ?? '';
      return {
        uuid,
        name: m['@_ZoneName'] ?? '',
        ip: ipFromLocation(location),
        location,
        isCoordinator: uuid === coordinatorUuid,
        invisible: m['@_Invisible'] === '1',
      };
    });
    const isBridge = new Set(
      rawMembers.filter((m) => m['@_IsZoneBridge'] === '1').map((m) => m['@_UUID'] as string),
    );

    const coordinator = all.find((s) => s.isCoordinator);
    const members = all
      .filter((s) => !s.invisible && !isBridge.has(s.uuid))
      .sort((a, b) => Number(b.isCoordinator) - Number(a.isCoordinator));
    if (members.length === 0) continue;

    groups.push({
      id,
      coordinatorUuid,
      coordinatorIp: coordinator?.ip ?? members[0].ip,
      members,
    });
  }
  return groups;
}

/** Fetch and parse the household's zone group topology from any player. */
export async function getZoneGroups(ip: string, timeoutMs?: number): Promise<ZoneGroup[]> {
  const r = await soapCall(ip, 'ZoneGroupTopology', 'GetZoneGroupState', {}, { timeoutMs });
  return parseZoneGroupState(r.ZoneGroupState ?? '');
}

/** IP of the coordinator of the group containing `speakerIp`, or null if unknown. */
export function findCoordinatorIp(groups: ZoneGroup[], speakerIp: string): string | null {
  for (const g of groups) {
    if (g.coordinatorIp === speakerIp || g.members.some((m) => m.ip === speakerIp)) {
      return g.coordinatorIp;
    }
  }
  return null;
}
