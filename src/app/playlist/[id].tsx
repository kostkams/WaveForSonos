import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { Button, IconButton, Snackbar, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MediaRow } from '@/components/MediaRow';
import { Native, type PlaylistPage } from '@/native';
import { enqueue, playNow } from '@/playback/controller';
import { errorText } from '@/playback/speakers';
import { openAddToPlaylist, trackActions } from '@/playback/trackActions';
import { useT } from '@/i18n';
import { useAppTheme } from '@/theme/theme';

export default function PlaylistScreen() {
  const { colors } = useAppTheme();
  const { t } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [pl, setPl] = useState<PlaylistPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Native.getPlaylist(id, null)
      .then((p) => !cancelled && setPl(p))
      .catch((e) => !cancelled && setMessage(t('ytPlaylist.loadFailed', { error: errorText(e) })))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const loadMore = useCallback(async () => {
    if (!pl?.nextPage || loading) return;
    setLoading(true);
    try {
      const more = await Native.getPlaylist(id, pl.nextPage);
      setPl({ ...pl, items: [...pl.items, ...more.items], nextPage: more.nextPage });
    } catch {
      setPl({ ...pl, nextPage: null });
    } finally {
      setLoading(false);
    }
  }, [id, pl, loading]);

  /** Loads all remaining pages so "play all" really means all. */
  const loadAll = async (): Promise<PlaylistPage | null> => {
    if (!pl) return null;
    let cur = pl;
    while (cur.nextPage) {
      const more = await Native.getPlaylist(id, cur.nextPage);
      cur = { ...cur, items: [...cur.items, ...more.items], nextPage: more.nextPage };
    }
    setPl(cur);
    return cur;
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <IconButton icon="arrow-left" onPress={() => router.back()} accessibilityLabel={t('common.back')} />
        <View style={styles.flex}>
          <Text variant="titleLarge" numberOfLines={1} style={{ color: colors.onSurface }}>
            {pl?.title ?? t('common.playlist')}
          </Text>
          {pl ? (
            <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
              {t('ytPlaylist.meta', { channel: pl.channel, count: pl.videoCount ?? pl.items.length })}
            </Text>
          ) : null}
        </View>
      </View>

      {pl ? (
        <View style={styles.actions}>
          <Button
            mode="contained"
            icon="play"
            onPress={async () => {
              const all = await loadAll().catch(() => pl);
              if (all) void playNow(all.items);
              router.push('/player');
            }}>
            {t('ytPlaylist.playAll')}
          </Button>
          <Button
            mode="outlined"
            icon="playlist-plus"
            onPress={async () => {
              const all = await loadAll().catch(() => pl);
              if (all) setMessage(t('track.addedManyToQueue', { count: enqueue(all.items) }));
            }}>
            {t('ytPlaylist.append')}
          </Button>
          <IconButton
            icon="playlist-music"
            mode="outlined"
            onPress={async () => {
              const all = await loadAll().catch(() => pl);
              if (all) openAddToPlaylist(all.items, all.title);
            }}
            accessibilityLabel={t('ytPlaylist.saveOwn')}
          />
        </View>
      ) : null}

      <FlatList
        data={pl?.items ?? []}
        keyExtractor={(i, k) => `${i.id}-${k}`}
        renderItem={({ item }) => (
          <MediaRow
            item={item}
            onPress={() => void playNow([item])}
            actions={trackActions(item, setMessage)}
          />
        )}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.6}
        ListFooterComponent={loading ? <ActivityIndicator style={{ margin: 24 }} color={colors.primary} /> : undefined}
      />

      <Snackbar visible={!!message} onDismiss={() => setMessage(null)} duration={2500}>
        {message ?? ''}
      </Snackbar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 8, gap: 4 },
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
});
