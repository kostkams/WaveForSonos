import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Banner, Button, IconButton, Snackbar, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { M3Slider } from '@/components/M3Slider';
import { Thumb } from '@/components/Thumb';
import { next, playIndex, previous, seekTo, skipBy, togglePlay } from '@/playback/controller';
import { refreshVolumes, setGroupVolume } from '@/playback/speakers';
import { openAddToPlaylist } from '@/playback/trackActions';
import { currentItem, usePlayer } from '@/state/playerStore';
import { selectionLabel, useSpeakers } from '@/state/speakerStore';
import { useT } from '@/i18n';
import { useAppTheme } from '@/theme/theme';
import { formatDuration } from '@/util/format';

export default function PlayerScreen() {
  const { colors } = useAppTheme();
  const { t } = useT();
  const { width, height } = useWindowDimensions();
  const item = usePlayer(currentItem);
  const index = usePlayer((s) => s.index);
  const transport = usePlayer((s) => s.transport);
  const position = usePlayer((s) => s.positionSec);
  const duration = usePlayer((s) => s.durationSec);
  const foreign = usePlayer((s) => s.foreign);
  const busy = usePlayer((s) => s.busy);
  const error = usePlayer((s) => s.error);
  const setPlayer = usePlayer((s) => s.set);
  const groups = useSpeakers((s) => s.groups);
  const selected = useSpeakers((s) => s.selected);
  const groupVolume = useSpeakers((s) => s.groupVolume);

  const [dragPos, setDragPos] = useState<number | null>(null);
  useEffect(() => {
    void refreshVolumes();
  }, []);

  const playing = transport === 'PLAYING' || transport === 'TRANSITIONING';
  const art = Math.min(width - 48, height * 0.38);
  const shown = dragPos ?? position;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <IconButton icon="chevron-down" onPress={() => router.back()} accessibilityLabel={t('player.minimize')} />
        <View style={styles.headerText}>
          <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant, letterSpacing: 0.8 }}>
            {t('player.playingOn')}
          </Text>
          <Text variant="labelLarge" style={{ color: colors.onSurface }}>
            {selectionLabel(groups, selected)}
          </Text>
        </View>
        <IconButton
          icon="playlist-music"
          disabled={!item}
          onPress={() => item && openAddToPlaylist([item])}
          accessibilityLabel={t('track.addToPlaylist')}
        />
        <IconButton
          icon="share-variant"
          disabled={!item || item.type === 'local'}
          onPress={() => item && void Share.share({ message: `https://youtu.be/${item.id}` })}
          accessibilityLabel={t('player.share')}
        />
      </View>

      <Banner
        visible={foreign}
        icon="information-outline"
        actions={[{ label: t('player.takeOver'), onPress: () => index >= 0 && void playIndex(index, position) }]}>
        {t('player.foreign')}
      </Banner>

      {item ? (
        <View style={styles.body}>
          <Thumb uri={item.thumbnail} width={art} height={art} radius={28} style={{ alignSelf: 'center' }} />

          <View style={{ gap: 4 }}>
            <Text variant="titleLarge" numberOfLines={2} style={{ color: colors.onSurface }}>
              {item.title}
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
              {item.channel}
            </Text>
          </View>

          <View>
            <M3Slider
              value={shown}
              max={duration ?? 1}
              onChange={setDragPos}
              onCommit={(v) => {
                setDragPos(null);
                void seekTo(v);
              }}
              disabled={!duration}
              label={t('player.position')}
            />
            <View style={styles.times}>
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                {formatDuration(shown)}
              </Text>
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                {formatDuration(duration)}
              </Text>
            </View>
          </View>

          <View style={styles.controls}>
            <IconButton icon="rewind-10" size={28} onPress={() => void skipBy(-10)} accessibilityLabel={t('player.back10')} />
            <IconButton
              icon="skip-previous"
              size={30}
              mode="contained"
              containerColor={colors.surfaceContainerHighest}
              onPress={() => void previous()}
              accessibilityLabel={t('common.previous')}
            />
            <Button
              mode="contained"
              onPress={() => void togglePlay()}
              loading={busy}
              style={styles.play}
              contentStyle={styles.playContent}
              accessibilityLabel={playing ? t('common.pause') : t('common.play')}>
              {busy ? '' : <MaterialCommunityIcons name={playing ? 'pause' : 'play'} size={40} color={colors.onPrimary} />}
            </Button>
            <IconButton
              icon="skip-next"
              size={30}
              mode="contained"
              containerColor={colors.surfaceContainerHighest}
              onPress={() => void next()}
              accessibilityLabel={t('common.next')}
            />
            <IconButton icon="fast-forward-10" size={28} onPress={() => void skipBy(10)} accessibilityLabel={t('player.forward10')} />
          </View>

          <View style={styles.volume}>
            <MaterialCommunityIcons name="volume-low" size={24} color={colors.onSurfaceVariant} />
            <M3Slider value={groupVolume ?? 0} max={100} onCommit={(v) => void setGroupVolume(v)} disabled={groupVolume === null} label={t('player.groupVolume')} />
            <MaterialCommunityIcons name="volume-high" size={24} color={colors.onSurfaceVariant} />
          </View>
        </View>
      ) : (
        <View style={[styles.body, { justifyContent: 'center', alignItems: 'center' }]}>
          <Text variant="titleMedium" style={{ color: colors.onSurface }}>
            {t('player.nothing')}
          </Text>
        </View>
      )}

      <View style={styles.bottom}>
        <Button
          mode="contained-tonal"
          icon="speaker-multiple"
          style={styles.flex}
          contentStyle={{ height: 48 }}
          onPress={() => {
            router.back();
            router.navigate('/speakers');
          }}>
          {selectionLabel(groups, selected)}
        </Button>
        <IconButton
          icon="playlist-music"
          mode="contained"
          containerColor={colors.surfaceContainerHighest}
          onPress={() => {
            router.back();
            router.navigate('/queue');
          }}
          accessibilityLabel={t('player.openQueue')}
        />
      </View>

      <Snackbar visible={!!error} onDismiss={() => setPlayer({ error: null })} duration={4000}>
        {error ?? ''}
      </Snackbar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, height: 64 },
  headerText: { flex: 1, alignItems: 'center', gap: 2 },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 8, gap: 20 },
  times: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  play: { borderRadius: 28 },
  playContent: { width: 104, height: 80 },
  volume: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingBottom: 16 },
});
