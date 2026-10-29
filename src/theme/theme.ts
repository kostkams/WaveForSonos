import { MD3DarkTheme, MD3LightTheme, useTheme, type MD3Theme } from 'react-native-paper';

import { SCHEMES, schemeFromDynamic, type SchemeColors, type SchemeId } from './schemes';

export type AppColors = MD3Theme['colors'] & {
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  selected: string;
  onSelected: string;
};

export type AppTheme = Omit<MD3Theme, 'colors'> & { colors: AppColors };

export function buildTheme(
  schemeId: SchemeId,
  dark: boolean,
  dynamic: Record<string, string> | null,
): AppTheme {
  const fromDynamic = dynamic ? schemeFromDynamic(dynamic, dark) : null;
  const c: SchemeColors = fromDynamic ?? (dark ? SCHEMES[schemeId].dark : SCHEMES[schemeId].light);
  const base = dark ? MD3DarkTheme : MD3LightTheme;
  return {
    ...base,
    dark,
    roundness: 4,
    colors: {
      ...base.colors,
      ...c,
      shadow: '#000000',
      scrim: '#000000',
      backdrop: dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.32)',
      surfaceDisabled: withAlpha(c.onSurface, 0.12),
      onSurfaceDisabled: withAlpha(c.onSurface, 0.38),
      elevation: {
        level0: 'transparent',
        level1: c.surfaceContainerLow,
        level2: c.surfaceContainer,
        level3: c.surfaceContainerHigh,
        level4: c.surfaceContainerHigh,
        level5: c.surfaceContainerHighest,
      },
    },
  };
}

export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export const useAppTheme = () => useTheme<AppTheme>();
