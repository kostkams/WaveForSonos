import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';

import { next, togglePlay } from '@/playback/controller';
import { currentItem, usePlayer } from '@/state/playerStore';
import { selectionLabel, useSpeakers } from '@/state/speakerStore';
import { useT } from '@/i18n';
import { useAppTheme } from '@/theme/theme';
import { Thumb } from './Thumb';

export function MiniPlayer() {
  const { colors } = useAppTheme();
  const { t } = useT();
  const item = usePlayer(currentItem);
  const transport = usePlayer((s) => s.transport);
  const position = usePlayer((s) => s.positionSec);
  const duration = usePlayer((s) => s.durationSec);
  const groups = useSpeakers((s) => s.groups);
  const selected = useSpeakers((s) => s.selected);
  if (!item) return null;

  const playing = transport === 'PLAYING' || transport === 'TRANSITIONING';
  const progress = duration ? Math.min(1, position / duration) : 0;
  return (
    <Pressable
      onPress={() => router.push('/player')}
      style={[styles.box, { backgroundColor: colors.surfaceContainerHighest }]}
      accessibilityRole="button"
      accessibilityLabel={t('mini.open', { title: item.title })}>
      <Thumb uri={item.thumbnail} width={48} height={48} radius={10} tint={colors.primary} />
      <View style={styles.text}>
        <Text variant="labelLarge" numberOfLines={1} style={{ color: colors.onSurface }}>
          {item.title}
        </Text>
        <View style={styles.sub}>
          <MaterialCommunityIcons name="speaker-multiple" size={14} color={colors.onSurfaceVariant} />
          <Text variant="bodySmall" numberOfLines={1} style={{ color: colors.onSurfaceVariant }}>
            {selectionLabel(groups, selected)}
          </Text>
        </View>
      </View>
      <IconButton icon={playing ? 'pause' : 'play'} iconColor={colors.onSurface} onPress={() => void togglePlay()} accessibilityLabel={playing ? t('common.pause') : t('common.play')} />
      <IconButton icon="skip-next" iconColor={colors.onSurface} onPress={() => void next()} accessibilityLabel={t('common.next')} />
      <View style={[styles.progress, { width: `${progress * 100}%`, backgroundColor: colors.primary }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    marginHorizontal: 12,
    marginBottom: 12,
    height: 64,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 8,
    overflow: 'hidden',
  },
  text: { flex: 1, minWidth: 0, gap: 2 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  progress: { position: 'absolute', left: 0, bottom: 0, height: 3 },
});
