import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT, type TranslationKey } from '@/i18n';
import { useAppTheme } from '@/theme/theme';
import { MiniPlayer } from './MiniPlayer';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const TABS: Record<string, { label: TranslationKey; icon: IconName; iconActive: IconName }> = {
  index: { label: 'tab.search', icon: 'magnify', iconActive: 'magnify' },
  queue: { label: 'tab.queue', icon: 'playlist-music-outline', iconActive: 'playlist-music' },
  library: { label: 'tab.library', icon: 'bookshelf', iconActive: 'bookshelf' },
  speakers: { label: 'tab.speakers', icon: 'speaker', iconActive: 'speaker' },
};

/** Material 3 navigation bar with the mini player on top. */
export function NavBar({ state, navigateToTab }: BottomTabBarProps) {
  const { colors } = useAppTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ backgroundColor: colors.background }}>
      <MiniPlayer />
      <View style={[styles.bar, { backgroundColor: colors.surfaceContainer, paddingBottom: 16 + insets.bottom }]}>
        {state.routes.map((route, i) => {
          const tab = TABS[route.name];
          if (!tab) return null;
          const focused = state.index === i;
          return (
            <Pressable
              key={route.key}
              style={styles.item}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={t(tab.label)}
              onPress={() => {
                if (!focused) navigateToTab(route.key);
              }}>
              <View style={[styles.pill, focused && { backgroundColor: colors.primaryContainer }]}>
                <MaterialCommunityIcons
                  name={focused ? tab.iconActive : tab.icon}
                  size={24}
                  color={focused ? colors.onPrimaryContainer : colors.onSurfaceVariant}
                />
              </View>
              <Text
                variant="labelMedium"
                style={{ color: focused ? colors.onSurface : colors.onSurfaceVariant, fontWeight: focused ? '700' : '500' }}>
                {t(tab.label)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', paddingTop: 12, paddingHorizontal: 8 },
  item: { flex: 1, alignItems: 'center', gap: 4 },
  pill: { width: 64, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
