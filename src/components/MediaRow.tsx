import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { IconButton, Menu, Text } from 'react-native-paper';

import { useT } from '@/i18n';
import type { MediaItem } from '@/native';
import { useAppTheme, withAlpha } from '@/theme/theme';
import { formatDuration, formatViews } from '@/util/format';
import { Thumb } from './Thumb';

export type RowAction = {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
};

type Props = {
  item: MediaItem;
  onPress: () => void;
  /** Entries of the ⋮ menu on the right. For YouTube playlists the button just opens them. */
  actions?: RowAction[];
  /** Overrides the second line (channel · views) */
  meta?: string;
};

export function MediaRow({ item, onPress, actions = [], meta: metaOverride }: Props) {
  const { colors } = useAppTheme();
  const { t, tn, lang } = useT();
  const [menu, setMenu] = useState(false);
  const isPlaylist = item.type === 'playlist';
  const badge = isPlaylist ? (item.videoCount ? tn('common.tracks', item.videoCount) : t('common.playlist')) : formatDuration(item.durationSec);
  const meta =
    metaOverride ??
    (isPlaylist ? t('track.playlistMeta', { channel: item.channel }) : [item.channel, formatViews(item.viewCount, lang)].filter(Boolean).join(' · '));

  return (
    <Pressable
      onPress={onPress}
      onLongPress={actions.length ? () => setMenu(true) : undefined}
      android_ripple={{ color: withAlpha(colors.onSurface, 0.1) }}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={item.title}>
      <Thumb
        uri={item.thumbnail}
        width={120}
        height={68}
        badge={badge || undefined}
        icon={isPlaylist ? 'playlist-play' : 'music-note'}
        tint={isPlaylist ? colors.tertiaryContainer : undefined}
      />
      <View style={styles.text}>
        <Text variant="titleSmall" numberOfLines={2} style={{ color: colors.onSurface }}>
          {item.title}
        </Text>
        <Text variant="bodySmall" numberOfLines={1} style={{ color: colors.onSurfaceVariant }}>
          {meta}
        </Text>
      </View>
      {isPlaylist ? (
        <IconButton icon="chevron-right" iconColor={colors.onSurfaceVariant} onPress={onPress} accessibilityLabel={t('track.openPlaylist')} />
      ) : actions.length ? (
        <Menu
          visible={menu}
          onDismiss={() => setMenu(false)}
          anchor={
            <IconButton icon="dots-vertical" iconColor={colors.onSurfaceVariant} onPress={() => setMenu(true)} accessibilityLabel={t('track.options', { title: item.title })} />
          }>
          {actions.map((a) => (
            <Menu.Item
              key={a.label}
              leadingIcon={a.icon}
              title={a.label}
              disabled={a.disabled}
              onPress={() => {
                setMenu(false);
                a.onPress();
              }}
            />
          ))}
        </Menu>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingLeft: 16, paddingRight: 4 },
  text: { flex: 1, minWidth: 0, gap: 4 },
});
