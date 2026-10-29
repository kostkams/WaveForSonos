import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Button, Chip, IconButton, Menu, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Thumb } from '@/components/Thumb';
import { clearUpcoming, move, playIndex, removeAt } from '@/playback/controller';
import { openAddToPlaylist } from '@/playback/trackActions';
import { currentItem, usePlayer } from '@/state/playerStore';
import { useSettings } from '@/state/settingsStore';
import { useT } from '@/i18n';
import { useAppTheme, withAlpha } from '@/theme/theme';
import { formatDuration, formatTotal } from '@/util/format';

export default function QueueScreen() {
  const { colors } = useAppTheme();
  const { t, tn } = useT();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const position = usePlayer((s) => s.positionSec);
  const setPlayer = usePlayer((s) => s.set);
  const autoAdvance = useSettings((s) => s.autoAdvance);
  const setSettings = useSettings((s) => s.set);
  const [menuFor, setMenuFor] = useState<number | null>(null);

  const cur = currentItem({ queue, index });
  const upcoming = queue.map((item, i) => ({ item, i })).filter(({ i }) => i > index);
  const total = queue.slice(Math.max(index, 0)).reduce((sum, q) => sum + (q.durationSec ?? 0), 0);
  const remaining = cur?.durationSec ? Math.max(0, cur.durationSec - position) : null;

  const toggleChip = (on: boolean) => ({
    mode: on ? ('flat' as const) : ('outlined' as const),
    selected: on,
    style: on ? { backgroundColor: colors.selected } : undefined,
  });

  return (
    <SafeAreaView edges={['top']} style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text variant="headlineSmall" style={{ color: colors.onSurface }}>
            {t('queue.title')}
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
            {tn('common.tracks', queue.length)}
            {total ? ` · ${formatTotal(total)}` : ''}
          </Text>
        </View>
        <IconButton
          icon="playlist-music"
          disabled={queue.length === 0}
          onPress={() => openAddToPlaylist(queue, t('queue.playlistTitle', { count: queue.length }))}
          accessibilityLabel={t('queue.saveAsPlaylist')}
        />
        <Button onPress={clearUpcoming} disabled={upcoming.length === 0}>
          {t('common.clear')}
        </Button>
      </View>

      <View style={styles.chips}>
        <Chip icon="shuffle-variant" {...toggleChip(shuffle)} onPress={() => setPlayer({ shuffle: !shuffle })}>
          {t('common.shuffle')}
        </Chip>
        <Chip icon="repeat" {...toggleChip(repeat)} onPress={() => setPlayer({ repeat: !repeat })}>
          {t('queue.repeat')}
        </Chip>
        <Chip icon="play-circle-outline" {...toggleChip(autoAdvance)} onPress={() => setSettings({ autoAdvance: !autoAdvance })}>
          {t('queue.autoAdvance')}
        </Chip>
      </View>

      <FlatList
        data={upcoming}
        keyExtractor={({ item }) => item.key}
        ListHeaderComponent={
          <>
            {cur ? (
              <>
                <Text variant="titleSmall" style={[styles.section, { color: colors.primary }]}>
                  {t('queue.nowPlaying')}
                </Text>
                <Pressable
                  onPress={() => router.push('/player')}
                  style={[styles.current, { backgroundColor: colors.primaryContainer }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('queue.nowPlayingLabel', { title: cur.title })}>
                  <Thumb uri={cur.thumbnail} width={80} height={45} radius={8} tint={colors.primary} icon="equalizer" />
                  <View style={styles.flexText}>
                    <Text variant="titleSmall" numberOfLines={1} style={{ color: colors.onPrimaryContainer }}>
                      {cur.title}
                    </Text>
                    <Text variant="bodySmall" numberOfLines={1} style={{ color: colors.onPrimaryContainer }}>
                      {cur.channel}
                      {remaining !== null ? ` · ${t('queue.remaining', { time: formatDuration(remaining) })}` : ''}
                    </Text>
                  </View>
                </Pressable>
              </>
            ) : null}
            {upcoming.length ? (
              <Text variant="titleSmall" style={[styles.section, { color: colors.onSurfaceVariant, paddingTop: 20 }]}>
                {t('queue.upNext')}
              </Text>
            ) : null}
          </>
        }
        renderItem={({ item: { item, i } }) => (
          <Pressable
            onPress={() => void playIndex(i)}
            android_ripple={{ color: withAlpha(colors.onSurface, 0.1) }}
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel={t('queue.playTrack', { title: item.title })}>
            <Menu
              visible={menuFor === i}
              onDismiss={() => setMenuFor(null)}
              anchor={<IconButton icon="drag" onPress={() => setMenuFor(i)} accessibilityLabel={t('queue.move')} />}>
              <Menu.Item
                leadingIcon="playlist-play"
                title={t('queue.playNext')}
                onPress={() => {
                  setMenuFor(null);
                  move(i, index + 1);
                }}
              />
              <Menu.Item
                leadingIcon="arrow-up"
                title={t('track.moveUp')}
                disabled={i <= index + 1}
                onPress={() => {
                  setMenuFor(null);
                  move(i, i - 1);
                }}
              />
              <Menu.Item
                leadingIcon="arrow-down"
                title={t('track.moveDown')}
                disabled={i >= queue.length - 1}
                onPress={() => {
                  setMenuFor(null);
                  move(i, i + 1);
                }}
              />
            </Menu>
            <Thumb uri={item.thumbnail} width={80} height={45} radius={8} tint={colors.surfaceContainerHighest} />
            <View style={styles.flexText}>
              <Text variant="titleSmall" numberOfLines={1} style={{ color: colors.onSurface }}>
                {item.title}
              </Text>
              <Text variant="bodySmall" numberOfLines={1} style={{ color: colors.onSurfaceVariant }}>
                {[item.channel, formatDuration(item.durationSec)].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <IconButton icon="close" onPress={() => removeAt(i)} accessibilityLabel={t('queue.remove')} />
          </Pressable>
        )}
        ListEmptyComponent={
          cur ? undefined : (
            <View style={styles.empty}>
              <Text variant="titleMedium" style={{ color: colors.onSurface }}>
                {t('queue.emptyTitle')}
              </Text>
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant, textAlign: 'center' }}>
                {t('queue.emptyText')}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Button mode="outlined" icon="plus" onPress={() => router.navigate('/')}>
              {t('queue.add')}
            </Button>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexText: { flex: 1, minWidth: 0, gap: 2, paddingLeft: 4 },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 12, paddingLeft: 16, paddingRight: 8 },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, flexWrap: 'wrap' },
  section: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  current: { marginHorizontal: 12, padding: 12, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 4 },
  empty: { padding: 32, gap: 8, alignItems: 'center' },
  footer: { padding: 16, alignItems: 'flex-start' },
});
