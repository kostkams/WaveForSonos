import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, IconButton, SegmentedButtons, Switch, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Native } from '@/native';
import { useSettings, type LanguageSetting, type ThemeMode } from '@/state/settingsStore';
import { selectionLabel, useSpeakers } from '@/state/speakerStore';
import { SCHEME_IDS, SCHEMES } from '@/theme/schemes';
import { useT } from '@/i18n';
import { useAppTheme } from '@/theme/theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const THEME_HINT = {
  system: 'settings.themeSystem',
  light: 'settings.themeLight',
  dark: 'settings.themeDark',
} as const satisfies Record<ThemeMode, string>;

const LANGUAGE_NAMES = { de: 'Deutsch', en: 'English' } as const;

export default function SettingsScreen() {
  const theme = useAppTheme();
  const { colors } = theme;
  const { t } = useT();
  const s = useSettings();
  const groups = useSpeakers((st) => st.groups);
  const selected = useSpeakers((st) => st.selected);

  const dynamicAvailable = useMemo(() => {
    try {
      return Native.getDynamicColors() !== null;
    } catch {
      return false;
    }
  }, []);

  const [batteryOk, setBatteryOk] = useState(true);
  useEffect(() => {
    const check = () => {
      try {
        setBatteryOk(Native.isIgnoringBatteryOptimizations());
      } catch {
        setBatteryOk(true);
      }
    };
    check();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && check());
    return () => sub.remove();
  }, []);

  const defaultLabel = s.defaultRooms.length ? selectionLabel(groups, s.defaultRooms) : t('settings.notSet');

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <IconButton icon="arrow-left" onPress={() => router.back()} accessibilityLabel={t('common.back')} />
        <Text variant="headlineSmall" style={{ color: colors.onSurface }}>
          {t('settings.title')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <Section title={t('settings.appearance')} />

        <View style={styles.block}>
          <Row
            icon="translate"
            title={t('settings.language')}
            subtitle={s.language === 'system' ? t('settings.languageSystem') : t('settings.languageFixed', { language: LANGUAGE_NAMES[s.language] })}
          />
          <SegmentedButtons
            value={s.language}
            onValueChange={(v) => s.set({ language: v as LanguageSetting })}
            buttons={[
              { value: 'system', label: t('settings.system'), showSelectedCheck: true },
              { value: 'de', label: LANGUAGE_NAMES.de, showSelectedCheck: true },
              { value: 'en', label: LANGUAGE_NAMES.en, showSelectedCheck: true },
            ]}
          />
        </View>

        <View style={styles.block}>
          <Row icon="theme-light-dark" title={t('settings.design')} subtitle={t(THEME_HINT[s.themeMode])} />
          <SegmentedButtons
            value={s.themeMode}
            onValueChange={(v) => s.set({ themeMode: v as ThemeMode })}
            buttons={[
              { value: 'system', label: t('settings.system'), showSelectedCheck: true },
              { value: 'light', label: t('settings.light'), showSelectedCheck: true },
              { value: 'dark', label: t('settings.dark'), showSelectedCheck: true },
            ]}
          />
        </View>

        <View style={styles.block}>
          <Row
            icon="palette-outline"
            title={t('settings.scheme')}
            subtitle={s.dynamicColors ? t('settings.schemeReplaced') : t('settings.schemeHint', { scheme: t(`scheme.${s.scheme}`) })}
          />
          <View style={styles.swatches} accessibilityRole="radiogroup">
            {SCHEME_IDS.map((id) => {
              const c = theme.dark ? SCHEMES[id].dark : SCHEMES[id].light;
              const on = id === s.scheme;
              return (
                <Pressable
                  key={id}
                  onPress={() => s.set({ scheme: id })}
                  style={[styles.swatchBtn, { opacity: s.dynamicColors ? 0.5 : 1 }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={t('settings.schemeLabel', { scheme: t(`scheme.${id}`) })}>
                  <View style={[styles.ring, { borderColor: on ? colors.primary : 'transparent' }]}>
                    <View style={styles.swatch}>
                      <View style={{ flex: 1, backgroundColor: c.primary }} />
                      <View style={{ flex: 1, flexDirection: 'row' }}>
                        <View style={{ flex: 1, backgroundColor: c.primaryContainer }} />
                        <View style={{ flex: 1, backgroundColor: c.selected }} />
                      </View>
                      {on ? (
                        <View style={styles.check}>
                          <MaterialCommunityIcons name="check" size={18} color={c.onPrimary} />
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <Text variant="labelMedium" style={{ color: on ? colors.onSurface : colors.onSurfaceVariant }}>
                    {t(`scheme.${id}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <SwitchRow
          icon="wallpaper"
          title={t('settings.dynamic')}
          subtitle={dynamicAvailable ? t('settings.dynamicHint') : t('settings.dynamicUnavailable')}
          value={s.dynamicColors && dynamicAvailable}
          disabled={!dynamicAvailable}
          onChange={(v) => s.set({ dynamicColors: v })}
        />

        <Divider style={styles.divider} />
        <Section title={t('settings.playback')} />

        <SwitchRow
          icon="play-circle-outline"
          title={t('settings.autoAdvance')}
          subtitle={t('settings.autoAdvanceHint')}
          value={s.autoAdvance}
          onChange={(v) => s.set({ autoAdvance: v })}
        />

        <SwitchRow
          icon="volume-high"
          title={t('settings.volumeKeys')}
          subtitle={t('settings.volumeKeysHint')}
          value={s.volumeKeys}
          onChange={(v) => s.set({ volumeKeys: v })}
        />

        <Pressable
          onPress={() => s.set({ defaultRooms: selected })}
          style={styles.rowPad}
          accessibilityRole="button"
          accessibilityLabel={t('settings.defaultSpeakersLabel')}>
          <Row icon="speaker-multiple" title={t('settings.defaultSpeakers')} subtitle={t('settings.defaultSpeakersHint', { rooms: defaultLabel })} trailing="chevron-right" />
        </Pressable>

        <View style={styles.rowPad}>
          <Row
            icon="battery-heart-variant"
            title={t('settings.battery')}
            subtitle={batteryOk ? t('settings.batteryOk') : t('settings.batteryNeeded')}>
            {!batteryOk ? (
              <Button mode="outlined" onPress={() => Native.requestIgnoreBatteryOptimizations()}>
                {t('settings.allow')}
              </Button>
            ) : null}
          </Row>
        </View>

        <SwitchRow
          icon="swap-horizontal"
          title={t('settings.compat')}
          subtitle={t('settings.compatHint')}
          value={s.streamFormat === 'aac'}
          onChange={(v) => s.set({ streamFormat: v ? 'aac' : 'm4a' })}
        />

        <Text variant="bodySmall" style={[styles.version, { color: colors.onSurfaceVariant }]}>
          {t('settings.version', { version: Constants.expoConfig?.version ?? '–' })}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title }: { title: string }) {
  const { colors } = useAppTheme();
  return (
    <Text variant="titleSmall" style={{ color: colors.primary, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }}>
      {title}
    </Text>
  );
}

function Row({
  icon,
  title,
  subtitle,
  trailing,
  children,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  trailing?: IconName;
  children?: React.ReactNode;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.row}>
      <MaterialCommunityIcons name={icon} size={24} color={colors.onSurfaceVariant} />
      <View style={styles.flex}>
        <Text variant="bodyLarge" style={{ color: colors.onSurface }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {children}
      {trailing ? <MaterialCommunityIcons name={trailing} size={24} color={colors.onSurfaceVariant} /> : null}
    </View>
  );
}

function SwitchRow(props: {
  icon: IconName;
  title: string;
  subtitle: string;
  value: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => !props.disabled && props.onChange(!props.value)}
      style={styles.rowPad}
      accessibilityRole="switch"
      accessibilityState={{ checked: props.value, disabled: props.disabled }}
      accessibilityLabel={props.title}>
      <Row icon={props.icon} title={props.title} subtitle={props.subtitle}>
        <Switch value={props.value} onValueChange={props.onChange} disabled={props.disabled} />
      </Row>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', height: 64, paddingHorizontal: 4, gap: 4 },
  block: { paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  rowPad: { paddingHorizontal: 16, paddingVertical: 10 },
  swatches: { flexDirection: 'row', justifyContent: 'space-between' },
  swatchBtn: { alignItems: 'center', gap: 6, minWidth: 60 },
  ring: { width: 56, height: 56, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 44, height: 44, borderRadius: 14, overflow: 'hidden' },
  check: { position: 'absolute', left: 0, right: 0, top: 2, alignItems: 'center' },
  divider: { marginHorizontal: 16, marginVertical: 8 },
  version: { textAlign: 'center', marginTop: 24 },
});
