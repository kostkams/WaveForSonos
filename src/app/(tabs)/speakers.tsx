import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Checkbox, IconButton, Snackbar, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { M3Slider } from '@/components/M3Slider';
import { discover, refreshRoomVolumes, refreshTopology, refreshVolumes, setRoomVolume, toggleRoom } from '@/playback/speakers';
import { allSpeakers, groupOf, speakerByUuid, useSpeakers } from '@/state/speakerStore';
import { useT } from '@/i18n';
import { useAppTheme } from '@/theme/theme';

export default function SpeakersScreen() {
  const { colors } = useAppTheme();
  const { t } = useT();
  const groups = useSpeakers((s) => s.groups);
  const selected = useSpeakers((s) => s.selected);
  const volumes = useSpeakers((s) => s.volumes);
  const discovering = useSpeakers((s) => s.discovering);
  const error = useSpeakers((s) => s.error);
  const set = useSpeakers((s) => s.set);
  const speakers = allSpeakers(groups);
  const leadUuid = selected[0];
  const leadName = leadUuid ? speakerByUuid(groups, leadUuid)?.name : undefined;
  const [drag, setDrag] = useState<{ uuid: string; v: number } | null>(null);

  useEffect(() => {
    void refreshTopology().then(refreshVolumes);
  }, []);

  // While this tab is visible, follow volume changes made elsewhere (keys, Sonos app, speaker buttons).
  useFocusEffect(
    useCallback(() => {
      void refreshRoomVolumes();
      const t = setInterval(() => void refreshRoomVolumes(), 3000);
      return () => clearInterval(t);
    }, []),
  );

  const statusOf = (uuid: string): { icon: keyof typeof MaterialCommunityIcons.glyphMap; text: string } => {
    if (uuid === leadUuid) return { icon: 'equalizer', text: t('speakers.leads') };
    if (selected.includes(uuid)) return { icon: 'link-variant', text: leadName ? t('speakers.groupedWith', { name: leadName }) : t('speakers.grouped') };
    const g = groupOf(groups, uuid);
    if (g && g.members.length > 1) {
      const coord = speakerByUuid(groups, g.coordinatorUuid);
      if (coord && coord.uuid !== uuid) return { icon: 'link-variant', text: t('speakers.groupedWith', { name: coord.name }) };
      return { icon: 'speaker-multiple', text: t('speakers.leadsOther') };
    }
    return { icon: 'check-circle-outline', text: t('speakers.ready') };
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text variant="headlineSmall" style={{ color: colors.onSurface }}>
            {t('speakers.title')}
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
            {discovering ? t('speakers.searching') : t('speakers.found', { count: speakers.length })}
          </Text>
        </View>
        <IconButton icon="refresh" onPress={() => void discover()} disabled={discovering} accessibilityLabel={t('speakers.rescan')} />
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={discovering} onRefresh={() => void discover()} colors={[colors.primary]} />}>
        {speakers.length ? (
          <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant, marginHorizontal: 4, marginBottom: 4 }}>
            {t('speakers.hint')}
          </Text>
        ) : null}

        {speakers.map((sp) => {
          const checked = selected.includes(sp.uuid);
          const status = statusOf(sp.uuid);
          const vol = volumes[sp.uuid] ?? 0;
          // While dragging, the 3 s volume refresh must not snap the thumb back.
          const shownVol = drag?.uuid === sp.uuid ? drag.v : vol;
          return (
            <View key={sp.uuid} style={[styles.card, { backgroundColor: checked ? colors.surfaceContainer : colors.surfaceContainerLow }]}>
              <View style={styles.cardTop}>
                <Checkbox.Android
                  status={checked ? 'checked' : 'unchecked'}
                  onPress={() => void toggleRoom(sp.uuid)}
                  color={colors.primary}
                  accessibilityLabel={checked ? t('speakers.deselect', { name: sp.name }) : t('speakers.select', { name: sp.name })}
                />
                <View style={styles.flex}>
                  <Text variant="titleMedium" style={{ color: colors.onSurface }} onPress={() => void toggleRoom(sp.uuid)}>
                    {sp.name}
                  </Text>
                  <View style={styles.status}>
                    <MaterialCommunityIcons name={status.icon} size={14} color={colors.onSurfaceVariant} />
                    <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                      {status.text}
                    </Text>
                  </View>
                </View>
                {sp.uuid === leadUuid ? (
                  <View style={[styles.badge, { backgroundColor: colors.primaryContainer }]}>
                    <Text variant="labelSmall" style={{ color: colors.onPrimaryContainer, fontWeight: '700' }}>
                      {t('speakers.badgeLead')}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.volume}>
                <MaterialCommunityIcons name="volume-high" size={20} color={colors.onSurfaceVariant} />
                <M3Slider
                  value={shownVol}
                  max={100}
                  onChange={(v) => setDrag({ uuid: sp.uuid, v })}
                  onCommit={(v) => {
                    setDrag(null);
                    void setRoomVolume(sp.uuid, v);
                  }}
                  label={t('speakers.volumeOf', { name: sp.name })}
                  disabled={!checked}
                />
                <Text variant="bodySmall" style={[styles.volText, { color: colors.onSurfaceVariant }]}>
                  {Math.round(shownVol)}
                </Text>
              </View>
            </View>
          );
        })}

        {!discovering && speakers.length === 0 ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="speaker-off" size={48} color={colors.onSurfaceVariant} />
            <Text variant="titleMedium" style={{ color: colors.onSurface }}>
              {t('speakers.noneTitle')}
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant, textAlign: 'center' }}>
              {t('speakers.noneText')}
            </Text>
            <Button mode="contained" icon="refresh" onPress={() => void discover()} style={{ marginTop: 8 }}>
              {t('speakers.retry')}
            </Button>
          </View>
        ) : null}
      </ScrollView>

      <Snackbar visible={!!error && speakers.length > 0} onDismiss={() => set({ error: null })} duration={3000}>
        {error ?? ''}
      </Snackbar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 12, paddingLeft: 16, paddingRight: 4 },
  list: { padding: 12, gap: 12 },
  card: { borderRadius: 16, paddingTop: 8, paddingBottom: 4, paddingHorizontal: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 8 },
  volume: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 44, paddingRight: 8 },
  volText: { width: 26, textAlign: 'right', fontVariant: ['tabular-nums'] },
  empty: { padding: 32, gap: 8, alignItems: 'center' },
});
