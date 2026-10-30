import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { SchemeId } from '@/theme/schemes';

export type ThemeMode = 'system' | 'light' | 'dark';
export type LanguageSetting = 'system' | 'de' | 'en';
export type StreamFormat = 'm4a' | 'aac';

type SettingsState = {
  /** UI language; 'system' follows the phone (German → de, everything else → en) */
  language: LanguageSetting;
  themeMode: ThemeMode;
  scheme: SchemeId;
  dynamicColors: boolean;
  autoAdvance: boolean;
  /** Hardware volume keys change the Sonos group volume while SonosTube plays */
  volumeKeys: boolean;
  /** m4a = original stream, aac = compatibility mode (ADTS remux) */
  streamFormat: StreamFormat;
  /** UUIDs of the rooms that should play by default; first one leads the group */
  defaultRooms: string[];
  /** Speaker IPs from the last successful discovery; probed directly when SSDP finds nothing */
  knownSpeakerIps: string[];
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      language: 'system',
      themeMode: 'system',
      scheme: 'terra',
      dynamicColors: false,
      autoAdvance: true,
      volumeKeys: true,
      streamFormat: 'm4a',
      defaultRooms: [],
      knownSpeakerIps: [],
      set: (patch) => set(patch),
    }),
    {
      name: 'sonostube-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ set: _set, ...rest }) => rest,
    },
  ),
);
