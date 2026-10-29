import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { DarkTheme, DefaultTheme, router, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { PermissionsAndroid, Platform, useColorScheme } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { resolveLang } from '@/i18n';
import { Native } from '@/native';
import { initController } from '@/playback/controller';
import { isDuplicateShare } from '@/playback/shareDedupe';
import { discover } from '@/playback/speakers';
import { useSettings } from '@/state/settingsStore';
import { buildTheme } from '@/theme/theme';
import { isUnplayableYouTubeUrl } from '@/youtube/links';

// Cold start from a link (share sheet on top) still gets the tabs underneath.
export const unstable_settings = {
  anchor: '(tabs)',
};

function openShared(text: string | null | undefined) {
  // Channel / feed links opened via VIEW intent are handled by +native-intent (stay put).
  if (!text || isUnplayableYouTubeUrl(text) || isDuplicateShare(text)) return;
  router.push({ pathname: '/share', params: { text } });
}

export default function RootLayout() {
  const system = useColorScheme();
  const themeMode = useSettings((s) => s.themeMode);
  const scheme = useSettings((s) => s.scheme);
  const dynamicColors = useSettings((s) => s.dynamicColors);
  const dark = themeMode === 'system' ? system === 'dark' : themeMode === 'dark';
  const language = useSettings((s) => s.language);

  // Keep the notification in the app's language.
  useEffect(() => {
    try {
      Native.setLanguage(resolveLang(language));
    } catch {
      // native module not ready
    }
  }, [language]);

  const theme = useMemo(() => {
    let dyn: Record<string, string> | null = null;
    if (dynamicColors) {
      try {
        dyn = Native.getDynamicColors();
      } catch {
        dyn = null;
      }
    }
    return buildTheme(scheme, dark, dyn);
  }, [scheme, dark, dynamicColors]);

  const navTheme = useMemo(() => {
    const base = dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.colors.primary,
        background: theme.colors.background,
        card: theme.colors.surface,
        text: theme.colors.onSurface,
        border: theme.colors.outlineVariant,
      },
    };
  }, [dark, theme]);

  useEffect(() => {
    initController();
    void discover();
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      void PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
    }
    // Opened via "Teilen" from the YouTube app (cold start) …
    setTimeout(() => openShared(Native.getInitialSharedText()), 300);
    // … or while already running.
    const sub = Native.addListener('onSharedText', ({ text }) => openShared(text));
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme} settings={{ icon: (p) => <MaterialCommunityIcons {...p} /> }}>
        <ThemeProvider value={navTheme}>
          <StatusBar style={dark ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="player" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="settings" />
            <Stack.Screen name="playlist/[id]" />
            <Stack.Screen name="mylist/[id]" />
            <Stack.Screen
              name="add-to-playlist"
              options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }}
            />
            <Stack.Screen
              name="share"
              options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }}
            />
          </Stack>
        </ThemeProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
