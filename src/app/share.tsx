import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Button, Chip, Switch, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Thumb } from '@/components/Thumb';
import { Native, type MediaItem } from '@/native';
import { enqueue, playNow } from '@/playback/controller';
import { errorText, toggleRoom } from '@/playback/speakers';
import { allSpeakers, useSpeakers } from '@/state/speakerStore';
import { useT } from '@/i18n';
import { useAppTheme } from '@/theme/theme';
import { formatDuration } from '@/util/format';
import { parseYouTubeLink } from '@/youtube/links';

type Loaded = {
  video: MediaItem | null;
  playlist: { title: string; items: MediaItem[]; count: number | null } | null;
  startSec: number | null;
};

export default function ShareSheet() {
  const { colors } = useAppTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { text } = useLocalSearchParams<{ text?: string }>();
  const groups = useSpeakers((s) => s.groups);
  const selected = useSpeakers((s) => s.selected);

  const link = useMemo(() => (text ? parseYouTubeLink(text) : null), [text]);
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wholePlaylist, setWholePlaylist] = useState(true);
  const [working, setWorking] = useState(false);
  const error = link ? loadError : t('share.notYouTube');

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    (async () => {
      try {
        // With a playlist, a private / removed video must not hide the (working) playlist.
        const videoReq = link.videoId ? Native.getVideoInfo(link.videoId) : Promise.resolve(null);
        const [video, pl] = await Promise.all([
          link.playlistId ? videoReq.catch(() => null) : videoReq,
          link.playlistId ? Native.getPlaylist(link.playlistId, null).catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setData({
          video,
          playlist: pl ? { title: pl.title, items: pl.items, count: pl.videoCount } : null,
          startSec: link.startSec,
        });
        if (!video && !pl) setLoadError(t('share.notFound'));
      } catch (e) {
        if (!cancelled) setLoadError(t('share.loadFailed', { error: errorText(e) }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [link]);

  const items = (): MediaItem[] => {
    if (!data) return [];
    if (data.playlist && (wholePlaylist || !data.video)) {
      if (!data.video) return data.playlist.items;
      // Start at the shared video, followed by the rest of the playlist.
      const idx = data.playlist.items.findIndex((i) => i.id === data.video!.id);
      return idx >= 0 ? data.playlist.items.slice(idx) : [data.video, ...data.playlist.items];
    }
    return data.video ? [data.video] : [];
  };

  // Double taps (buttons / backdrop) must act once; a second router.back() pops the screen below.
  const closed = useRef(false);
  const busy = useRef(false);
  const close = () => {
    if (closed.current) return;
    closed.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const onPlay = async () => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    const list = items();
    const start = data?.video && list[0]?.id === data.video.id ? data.startSec : null;
    close();
    await playNow(list, start);
  };

  const onQueue = () => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    enqueue(items());
    close();
  };

  const head = data?.video ?? (data?.playlist ? data.playlist.items[0] : null);
  const speakers = allSpeakers(groups);

  return (
    <View style={styles.flex}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }]} onPress={close} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { backgroundColor: colors.surfaceContainerLow, paddingBottom: 28 + insets.bottom }]}>
        <View style={styles.handleWrap}>
          <View style={[styles.handle, { backgroundColor: colors.outline }]} />
        </View>

        <Text variant="titleSmall" style={{ color: colors.primary }}>
          {t('share.title')}
        </Text>

        {error ? (
          <Text variant="bodyMedium" style={{ color: colors.error }}>
            {error}
          </Text>
        ) : !data ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
        ) : (
          <>
            {head ? (
              <View style={styles.preview}>
                <Thumb uri={head.thumbnail} width={120} height={68} badge={formatDuration(head.durationSec) || undefined} />
                <View style={styles.flexText}>
                  <Text variant="titleMedium" numberOfLines={2} style={{ color: colors.onSurface }}>
                    {data.video ? data.video.title : data.playlist?.title}
                  </Text>
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    {data.video ? data.video.channel : t('share.playlistMeta', { count: data.playlist?.count ?? data.playlist?.items.length ?? 0 })}
                  </Text>
                </View>
              </View>
            ) : null}

            <View style={{ gap: 10 }}>
              <Text variant="titleSmall" style={{ color: colors.onSurfaceVariant }}>
                {t('share.playOn')}
              </Text>
              <View style={styles.chips}>
                {speakers.length === 0 ? (
                  <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                    {t('share.findingSpeakers')}
                  </Text>
                ) : null}
                {speakers.map((sp) => {
                  const on = selected.includes(sp.uuid);
                  return (
                    <Chip
                      key={sp.uuid}
                      mode={on ? 'flat' : 'outlined'}
                      selected={on}
                      showSelectedCheck
                      style={on ? { backgroundColor: colors.selected } : undefined}
                      onPress={() => void toggleRoom(sp.uuid)}>
                      {sp.name}
                    </Chip>
                  );
                })}
              </View>
            </View>

            {data.video && data.playlist ? (
              <Pressable style={styles.switchRow} onPress={() => setWholePlaylist(!wholePlaylist)} accessibilityRole="switch" accessibilityState={{ checked: wholePlaylist }}>
                <View style={styles.flexText}>
                  <Text variant="bodyLarge" style={{ color: colors.onSurface }}>
                    {t('share.wholePlaylist')}
                  </Text>
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    {t('share.belongsTo', { title: data.playlist.title, count: data.playlist.count ?? data.playlist.items.length })}
                  </Text>
                </View>
                <Switch value={wholePlaylist} onValueChange={setWholePlaylist} />
              </Pressable>
            ) : null}

            <View style={{ gap: 10 }}>
              <Button mode="contained" icon="play" onPress={() => void onPlay()} disabled={working || !selected.length} contentStyle={styles.btn}>
                {t('share.playNow')}
              </Button>
              <Button mode="outlined" icon="playlist-plus" onPress={onQueue} disabled={working} contentStyle={styles.btn}>
                {t('share.toQueue')}
              </Button>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  flexText: { flex: 1, minWidth: 0, gap: 4 },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 8, gap: 20 },
  handleWrap: { alignItems: 'center', paddingTop: 8 },
  handle: { width: 32, height: 4, borderRadius: 2 },
  preview: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  btn: { height: 52 },
});
