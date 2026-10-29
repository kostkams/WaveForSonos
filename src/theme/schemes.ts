// Material 3 colour schemes, matching the UI design (Settings > Farbschema).

export type SchemeId = 'terra' | 'ocean' | 'forest' | 'lav' | 'petrol';

export type SchemeColors = {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  background: string;
  onBackground: string;
  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  /** Background of selected filter chips / segments */
  selected: string;
  onSelected: string;
};

const errLight = { error: '#BA1A1A', onError: '#FFFFFF', errorContainer: '#FFDAD6', onErrorContainer: '#410002' };
const errDark = { error: '#FFB4AB', onError: '#690005', errorContainer: '#93000A', onErrorContainer: '#FFDAD6' };

type Pair = { light: SchemeColors; dark: SchemeColors };

export const SCHEMES: Record<SchemeId, { label: string } & Pair> = {
  terra: {
    label: 'Terrakotta',
    light: {
      primary: '#8F4C38', onPrimary: '#FFFFFF', primaryContainer: '#FFDBD1', onPrimaryContainer: '#3A0B01',
      secondary: '#77574E', onSecondary: '#FFFFFF', secondaryContainer: '#FFDBD1', onSecondaryContainer: '#2C150F',
      tertiary: '#6C5D2F', onTertiary: '#FFFFFF', tertiaryContainer: '#F5E1A7', onTertiaryContainer: '#231B00',
      ...errLight,
      background: '#FFF8F6', onBackground: '#231917', surface: '#FFF8F6', onSurface: '#231917',
      surfaceVariant: '#F5DED8', onSurfaceVariant: '#53433F', outline: '#85736E', outlineVariant: '#D8C2BC',
      inverseSurface: '#392E2B', inverseOnSurface: '#FFEDE8', inversePrimary: '#FFB5A0',
      surfaceContainerLowest: '#FFFFFF', surfaceContainerLow: '#FFF1ED', surfaceContainer: '#FCEAE5',
      surfaceContainerHigh: '#F7E4E0', surfaceContainerHighest: '#F1DFDA',
      selected: '#E7BDB1', onSelected: '#231917',
    },
    dark: {
      primary: '#FFB5A0', onPrimary: '#561F0F', primaryContainer: '#723523', onPrimaryContainer: '#FFDBD1',
      secondary: '#E7BDB2', onSecondary: '#442A22', secondaryContainer: '#5D4037', onSecondaryContainer: '#FFDBD1',
      tertiary: '#D8C58D', onTertiary: '#3B2F05', tertiaryContainer: '#534619', onTertiaryContainer: '#F5E1A7',
      ...errDark,
      background: '#1A110F', onBackground: '#F1DFDA', surface: '#1A110F', onSurface: '#F1DFDA',
      surfaceVariant: '#53433F', onSurfaceVariant: '#D8C2BC', outline: '#A08C87', outlineVariant: '#53433F',
      inverseSurface: '#F1DFDA', inverseOnSurface: '#392E2B', inversePrimary: '#8F4C38',
      surfaceContainerLowest: '#140C0A', surfaceContainerLow: '#231917', surfaceContainer: '#271D1B',
      surfaceContainerHigh: '#322825', surfaceContainerHighest: '#3D3230',
      selected: '#5D4037', onSelected: '#FFDBD1',
    },
  },
  ocean: {
    label: 'Ozean',
    light: {
      primary: '#415F91', onPrimary: '#FFFFFF', primaryContainer: '#D6E3FF', onPrimaryContainer: '#001B3E',
      secondary: '#565F71', onSecondary: '#FFFFFF', secondaryContainer: '#DAE2F9', onSecondaryContainer: '#131C2B',
      tertiary: '#705575', onTertiary: '#FFFFFF', tertiaryContainer: '#FAD8FD', onTertiaryContainer: '#28132E',
      ...errLight,
      background: '#F9F9FF', onBackground: '#191C20', surface: '#F9F9FF', onSurface: '#191C20',
      surfaceVariant: '#E0E2EC', onSurfaceVariant: '#44474E', outline: '#74777F', outlineVariant: '#C4C6D0',
      inverseSurface: '#2E3036', inverseOnSurface: '#F0F0F7', inversePrimary: '#AAC7FF',
      surfaceContainerLowest: '#FFFFFF', surfaceContainerLow: '#F3F3FA', surfaceContainer: '#EDEDF4',
      surfaceContainerHigh: '#E7E8EE', surfaceContainerHighest: '#E2E2E9',
      selected: '#DAE2F9', onSelected: '#131C2B',
    },
    dark: {
      primary: '#AAC7FF', onPrimary: '#0A305F', primaryContainer: '#284777', onPrimaryContainer: '#D6E3FF',
      secondary: '#BEC6DC', onSecondary: '#283141', secondaryContainer: '#3E4759', onSecondaryContainer: '#DAE2F9',
      tertiary: '#DDBCE0', onTertiary: '#3F2844', tertiaryContainer: '#573E5C', onTertiaryContainer: '#FAD8FD',
      ...errDark,
      background: '#111318', onBackground: '#E2E2E9', surface: '#111318', onSurface: '#E2E2E9',
      surfaceVariant: '#44474E', onSurfaceVariant: '#C4C6D0', outline: '#8E9099', outlineVariant: '#44474E',
      inverseSurface: '#E2E2E9', inverseOnSurface: '#2E3036', inversePrimary: '#415F91',
      surfaceContainerLowest: '#0C0E13', surfaceContainerLow: '#191C20', surfaceContainer: '#1D2024',
      surfaceContainerHigh: '#282A2F', surfaceContainerHighest: '#33353A',
      selected: '#3E4759', onSelected: '#DAE2F9',
    },
  },
  forest: {
    label: 'Wald',
    light: {
      primary: '#4C662B', onPrimary: '#FFFFFF', primaryContainer: '#CDEDA3', onPrimaryContainer: '#102000',
      secondary: '#586249', onSecondary: '#FFFFFF', secondaryContainer: '#DCE7C8', onSecondaryContainer: '#151E0B',
      tertiary: '#386663', onTertiary: '#FFFFFF', tertiaryContainer: '#BCECE7', onTertiaryContainer: '#00201E',
      ...errLight,
      background: '#F9FAEF', onBackground: '#1A1C16', surface: '#F9FAEF', onSurface: '#1A1C16',
      surfaceVariant: '#E1E4D5', onSurfaceVariant: '#44483D', outline: '#75796C', outlineVariant: '#C5C8BA',
      inverseSurface: '#2F312A', inverseOnSurface: '#F1F2E6', inversePrimary: '#B1D18A',
      surfaceContainerLowest: '#FFFFFF', surfaceContainerLow: '#F3F4E9', surfaceContainer: '#EEEFE3',
      surfaceContainerHigh: '#E8E9DE', surfaceContainerHighest: '#E2E3D8',
      selected: '#DCE7C8', onSelected: '#151E0B',
    },
    dark: {
      primary: '#B1D18A', onPrimary: '#1F3701', primaryContainer: '#354E16', onPrimaryContainer: '#CDEDA3',
      secondary: '#BFCBAD', onSecondary: '#2A331E', secondaryContainer: '#404A33', onSecondaryContainer: '#DCE7C8',
      tertiary: '#A0D0CB', onTertiary: '#003735', tertiaryContainer: '#1F4E4B', onTertiaryContainer: '#BCECE7',
      ...errDark,
      background: '#12140E', onBackground: '#E2E3D8', surface: '#12140E', onSurface: '#E2E3D8',
      surfaceVariant: '#44483D', onSurfaceVariant: '#C5C8BA', outline: '#8F9285', outlineVariant: '#44483D',
      inverseSurface: '#E2E3D8', inverseOnSurface: '#2F312A', inversePrimary: '#4C662B',
      surfaceContainerLowest: '#0C0F09', surfaceContainerLow: '#1A1C16', surfaceContainer: '#1E201A',
      surfaceContainerHigh: '#282B24', surfaceContainerHighest: '#33362E',
      selected: '#404A33', onSelected: '#DCE7C8',
    },
  },
  lav: {
    label: 'Lavendel',
    light: {
      primary: '#65558F', onPrimary: '#FFFFFF', primaryContainer: '#E9DDFF', onPrimaryContainer: '#210F47',
      secondary: '#625B71', onSecondary: '#FFFFFF', secondaryContainer: '#E8DEF8', onSecondaryContainer: '#1E192B',
      tertiary: '#7E5260', onTertiary: '#FFFFFF', tertiaryContainer: '#FFD9E3', onTertiaryContainer: '#31101D',
      ...errLight,
      background: '#FDF7FF', onBackground: '#1D1B20', surface: '#FDF7FF', onSurface: '#1D1B20',
      surfaceVariant: '#E7E0EB', onSurfaceVariant: '#49454E', outline: '#7A757F', outlineVariant: '#CAC4CF',
      inverseSurface: '#322F35', inverseOnSurface: '#F5EFF7', inversePrimary: '#CFBDFE',
      surfaceContainerLowest: '#FFFFFF', surfaceContainerLow: '#F7F2FA', surfaceContainer: '#F2ECF4',
      surfaceContainerHigh: '#ECE6EE', surfaceContainerHighest: '#E6E0E9',
      selected: '#E8DEF8', onSelected: '#1E192B',
    },
    dark: {
      primary: '#CFBDFE', onPrimary: '#36265D', primaryContainer: '#4D3D75', onPrimaryContainer: '#E9DDFF',
      secondary: '#CBC2DB', onSecondary: '#332D41', secondaryContainer: '#4A4458', onSecondaryContainer: '#E8DEF8',
      tertiary: '#EFB8C8', onTertiary: '#4A2532', tertiaryContainer: '#633B48', onTertiaryContainer: '#FFD9E3',
      ...errDark,
      background: '#141218', onBackground: '#E6E0E9', surface: '#141218', onSurface: '#E6E0E9',
      surfaceVariant: '#49454E', onSurfaceVariant: '#CAC4CF', outline: '#948F99', outlineVariant: '#49454E',
      inverseSurface: '#E6E0E9', inverseOnSurface: '#322F35', inversePrimary: '#65558F',
      surfaceContainerLowest: '#0F0D13', surfaceContainerLow: '#1D1B20', surfaceContainer: '#211F24',
      surfaceContainerHigh: '#2B292F', surfaceContainerHighest: '#36343A',
      selected: '#4A4458', onSelected: '#E8DEF8',
    },
  },
  petrol: {
    label: 'Petrol',
    light: {
      primary: '#006A6A', onPrimary: '#FFFFFF', primaryContainer: '#9CF1F0', onPrimaryContainer: '#002020',
      secondary: '#4A6363', onSecondary: '#FFFFFF', secondaryContainer: '#CCE8E7', onSecondaryContainer: '#051F1F',
      tertiary: '#4B607C', onTertiary: '#FFFFFF', tertiaryContainer: '#D3E4FF', onTertiaryContainer: '#041C35',
      ...errLight,
      background: '#F4FBFA', onBackground: '#161D1D', surface: '#F4FBFA', onSurface: '#161D1D',
      surfaceVariant: '#DAE5E4', onSurfaceVariant: '#3F4948', outline: '#6F7979', outlineVariant: '#BEC9C8',
      inverseSurface: '#2B3231', inverseOnSurface: '#ECF2F1', inversePrimary: '#80D5D4',
      surfaceContainerLowest: '#FFFFFF', surfaceContainerLow: '#EFF5F4', surfaceContainer: '#E9EFEE',
      surfaceContainerHigh: '#E3E9E8', surfaceContainerHighest: '#DDE4E3',
      selected: '#CCE8E7', onSelected: '#051F1F',
    },
    dark: {
      primary: '#80D5D4', onPrimary: '#003737', primaryContainer: '#004F4F', onPrimaryContainer: '#9CF1F0',
      secondary: '#B0CCCB', onSecondary: '#1B3434', secondaryContainer: '#324B4B', onSecondaryContainer: '#CCE8E7',
      tertiary: '#B3C8E8', onTertiary: '#1C314B', tertiaryContainer: '#334863', onTertiaryContainer: '#D3E4FF',
      ...errDark,
      background: '#0E1514', onBackground: '#DDE4E3', surface: '#0E1514', onSurface: '#DDE4E3',
      surfaceVariant: '#3F4948', onSurfaceVariant: '#BEC9C8', outline: '#889392', outlineVariant: '#3F4948',
      inverseSurface: '#DDE4E3', inverseOnSurface: '#2B3231', inversePrimary: '#006A6A',
      surfaceContainerLowest: '#090F0F', surfaceContainerLow: '#161D1D', surfaceContainer: '#1A2121',
      surfaceContainerHigh: '#252B2B', surfaceContainerHighest: '#2F3636',
      selected: '#324B4B', onSelected: '#CCE8E7',
    },
  },
};

export const SCHEME_IDS = Object.keys(SCHEMES) as SchemeId[];

/**
 * Builds a scheme from Android Material You system palettes (keys like "accent1_600").
 * Android tone suffix → M3 tone: 0→100, 10→99, 50→95, 100→90, 200→80, … 900→10, 1000→0.
 */
export function schemeFromDynamic(p: Record<string, string>, dark: boolean): SchemeColors | null {
  const g = (k: string) => p[k];
  if (!g('accent1_600') || !g('neutral1_900')) return null;
  if (!dark) {
    return {
      primary: g('accent1_600'), onPrimary: g('accent1_0'), primaryContainer: g('accent1_100'), onPrimaryContainer: g('accent1_900'),
      secondary: g('accent2_600'), onSecondary: g('accent2_0'), secondaryContainer: g('accent2_100'), onSecondaryContainer: g('accent2_900'),
      tertiary: g('accent3_600'), onTertiary: g('accent3_0'), tertiaryContainer: g('accent3_100'), onTertiaryContainer: g('accent3_900'),
      ...errLight,
      background: g('neutral1_10'), onBackground: g('neutral1_900'), surface: g('neutral1_10'), onSurface: g('neutral1_900'),
      surfaceVariant: g('neutral2_100'), onSurfaceVariant: g('neutral2_700'), outline: g('neutral2_500'), outlineVariant: g('neutral2_200'),
      inverseSurface: g('neutral1_800'), inverseOnSurface: g('neutral1_50'), inversePrimary: g('accent1_200'),
      surfaceContainerLowest: g('neutral1_0'), surfaceContainerLow: g('neutral1_10'), surfaceContainer: g('neutral1_50'),
      surfaceContainerHigh: g('neutral1_50'), surfaceContainerHighest: g('neutral1_100'),
      selected: g('accent2_100'), onSelected: g('accent2_900'),
    };
  }
  return {
    primary: g('accent1_200'), onPrimary: g('accent1_800'), primaryContainer: g('accent1_700'), onPrimaryContainer: g('accent1_100'),
    secondary: g('accent2_200'), onSecondary: g('accent2_800'), secondaryContainer: g('accent2_700'), onSecondaryContainer: g('accent2_100'),
    tertiary: g('accent3_200'), onTertiary: g('accent3_800'), tertiaryContainer: g('accent3_700'), onTertiaryContainer: g('accent3_100'),
    ...errDark,
    background: g('neutral1_900'), onBackground: g('neutral1_100'), surface: g('neutral1_900'), onSurface: g('neutral1_100'),
    surfaceVariant: g('neutral2_700'), onSurfaceVariant: g('neutral2_200'), outline: g('neutral2_400'), outlineVariant: g('neutral2_700'),
    inverseSurface: g('neutral1_100'), inverseOnSurface: g('neutral1_800'), inversePrimary: g('accent1_600'),
    surfaceContainerLowest: g('neutral1_1000'), surfaceContainerLow: g('neutral1_900'), surfaceContainer: g('neutral1_800'),
    surfaceContainerHigh: g('neutral1_800'), surfaceContainerHighest: g('neutral1_700'),
    selected: g('accent2_700'), onSelected: g('accent2_100'),
  };
}
