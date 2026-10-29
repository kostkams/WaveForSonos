import { create } from 'zustand';

import { t } from '@/i18n';
import type { SonosSpeaker, ZoneGroup } from '@/sonos';

type SpeakerState = {
  groups: ZoneGroup[];
  /** Selected room UUIDs; the first one leads (coordinates) the group */
  selected: string[];
  volumes: Record<string, number>;
  groupVolume: number | null;
  discovering: boolean;
  /** IP of a speaker that answered discovery; used for topology queries */
  seedIp: string | null;
  error: string | null;
  set: (patch: Partial<Omit<SpeakerState, 'set'>>) => void;
};

export const useSpeakers = create<SpeakerState>()((set) => ({
  groups: [],
  selected: [],
  volumes: {},
  groupVolume: null,
  discovering: false,
  seedIp: null,
  error: null,
  set: (patch) => set(patch),
}));

export function allSpeakers(groups: ZoneGroup[]): SonosSpeaker[] {
  return groups
    .flatMap((g) => g.members)
    .filter((m) => !m.invisible)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export function speakerByUuid(groups: ZoneGroup[], uuid: string): SonosSpeaker | undefined {
  return allSpeakers(groups).find((s) => s.uuid === uuid);
}

export function groupOf(groups: ZoneGroup[], uuid: string): ZoneGroup | undefined {
  return groups.find((g) => g.members.some((m) => m.uuid === uuid));
}

/** Human label of the current selection, e.g. "Wohnzimmer + Küche". */
export function selectionLabel(groups: ZoneGroup[], selected: string[]): string {
  const names = selected.map((u) => speakerByUuid(groups, u)?.name).filter(Boolean) as string[];
  if (names.length === 0) return t('speakers.none');
  if (names.length <= 2) return names.join(' + ');
  return t('speakers.andMore', { first: names[0], count: names.length - 1 });
}
