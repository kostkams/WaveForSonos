import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { Button, Dialog, IconButton, Portal, SegmentedButtons, Snackbar, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MediaRow } from '@/components/MediaRow';
import { Thumb } from '@/components/Thumb';
import { Native } from '@/native';
import { playNow } from '@/playback/controller';
import { errorText } from '@/playback/speakers';
import { trackActions } from '@/playback/trackActions';
import { groupByDay, useHistory } from '@/state/historyStore';
import { useLocalFiles } from '@/state/localFilesStore';
import { shuffled, totalDuration, usePlaylists } from '@/state/playlistStore';
import { useT } from '@/i18n';
import { useAppTheme, withAlpha } from '@/theme/theme';
import { formatDuration, formatTotal } from '@/util/format';

type Segment = 'playlists' | 'files' | 'history';

export default function LibraryScreen() {
  const { colors } = useAppTheme();
  const { t } = useT();
  const [segment, setSegment] = useState<Segment>('playlists');
  const [message, setMessage] = useState<string | null>(null);

  return (
    <SafeAreaView edges={['top']} style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text variant="headlineSmall" style={{ color: colors.onSurface }}>
          {t('library.title')}
        </Text>
        <SegmentedButtons
          value={segment}
          onValueChange={(v) => setSegment(v as Segment)}
          buttons={[
            { value: 'playlists', label: t('library.playlists'), icon: 'playlist-music', showSelectedCheck: false },
            { value: 'files', label: t('library.files'), icon: 'folder-music-outline', showSelectedCheck: false },
            { value: 'history', label: t('library.history'), icon: 'history', showSelectedCheck: false },
          ]}
        />
      </View>

      {segment === 'playlists' ? (
        <PlaylistsView />
      ) : segment === 'files' ? (
        <FilesView notify={setMessage} />
      ) : (
        <HistoryView notify={setMessage} />
      )}

      <Snackbar visible={!!message} onDismiss={() => setMessage(null)} duration={2500}>
        {message ?? ''}
      </Snackbar>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------- playlists

function PlaylistsView() {
  const { colors } = useAppTheme();
  const { t, tn, lang } = useT();
  const playlists = usePlaylists((s) => s.playlists);
  const create = usePlaylists((s) => s.create);
  const [naming, setNaming] = useState<string | null>(null);

  const submit = () => {
    const id = create(naming ?? '');
    setNaming(null);
    router.push({ pathname: '/mylist/[id]', params: { id } });
  };

  return (
    <>
      <FlatList
        data={playlists}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={
          playlists.length ? (
            <View style={styles.newRow}>
              <Button mode="outlined" icon="plus" onPress={() => setNaming('')}>
                {t('library.newPlaylist')}
              </Button>
            </View>
          ) : undefined
        }
        renderItem={({ item: p }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/mylist/[id]', params: { id: p.id } })}
            android_ripple={{ color: withAlpha(colors.onSurface, 0.1) }}
            style={styles.plRow}
            accessibilityRole="button"
            accessibilityLabel={t('library.openPlaylist', { name: p.name })}>
            <Thumb uri={p.items[0]?.thumbnail} width={64} height={64} radius={14} icon="playlist-music" tint={colors.secondaryContainer} />
            <View style={styles.flexText}>
              <Text variant="titleMedium" numberOfLines={1} style={{ color: colors.onSurface }}>
                {p.name}
              </Text>
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                {tn('common.tracks', p.items.length)}
                {p.items.length ? ` · ${formatTotal(totalDuration(p.items), lang)}` : ''}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={colors.onSurfaceVariant} />
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="playlist-music" size={48} color={colors.onSurfaceVariant} />
            <Text variant="titleMedium" style={{ color: colors.onSurface }}>
              {t('library.noPlaylistsTitle')}
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant, textAlign: 'center' }}>
              {t('library.noPlaylistsText')}
            </Text>
            <Button mode="contained" icon="plus" onPress={() => setNaming('')} style={{ marginTop: 8 }}>
              {t('library.newPlaylist')}
            </Button>
          </View>
        }
      />

      <Portal>
        <Dialog visible={naming !== null} onDismiss={() => setNaming(null)}>
          <Dialog.Title>{t('library.newPlaylist')}</Dialog.Title>
          <Dialog.Content>
            <TextInput mode="outlined" label={t('common.name')} value={naming ?? ''} onChangeText={setNaming} autoFocus onSubmitEditing={submit} returnKeyType="done" />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setNaming(null)}>{t('common.cancel')}</Button>
            <Button onPress={submit}>{t('common.create')}</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

// ---------------------------------------------------------------- local files

function FilesView({ notify }: { notify: (m: string) => void }) {
  const { colors } = useAppTheme();
  const { t, tn, lang } = useT();
  const files = useLocalFiles((s) => s.files);
  const addFiles = useLocalFiles((s) => s.add);
  const removeFile = useLocalFiles((s) => s.remove);
  const [picking, setPicking] = useState(false);

  const pick = async () => {
    setPicking(true);
    try {
      const picked = await Native.pickAudioFiles();
      if (!picked.length) return;
      const n = addFiles(picked);
      notify(n ? t('files.added', { tracks: tn('common.tracks', n) }) : t('files.noneNew'));
    } catch (e) {
      notify(t('files.pickFailed', { error: errorText(e) }));
    } finally {
      setPicking(false);
    }
  };

  return (
    <FlatList
      data={files}
      keyExtractor={(f) => f.id}
      ListHeaderComponent={
        <View style={styles.filesBar}>
          <Button mode="contained-tonal" icon="file-music-outline" onPress={() => void pick()} loading={picking} disabled={picking}>
            {t('files.add')}
          </Button>
          <View style={styles.flex} />
          {files.length ? (
            <>
              <IconButton icon="shuffle-variant" onPress={() => void playNow(shuffled(files))} accessibilityLabel={t('files.shuffleAll')} />
              <IconButton icon="play" mode="contained" onPress={() => void playNow(files)} accessibilityLabel={t('files.playAll')} />
            </>
          ) : null}
        </View>
      }
      renderItem={({ item, index }) => (
        <MediaRow
          item={item}
          meta={[item.channel || t('files.unknownArtist'), formatDuration(item.durationSec), (item.ext ?? '').toUpperCase()].filter(Boolean).join(' · ')}
          onPress={() => void playNow(files.slice(index))}
          actions={trackActions(item, notify, [
            {
              label: t('files.remove'),
              icon: 'close',
              onPress: () => {
                removeFile(item.id);
                notify(t('files.removed'));
              },
            },
          ])}
        />
      )}
      ListFooterComponent={
        files.length ? (
          <Text variant="bodySmall" style={[styles.footerNote, { color: colors.onSurfaceVariant }]}>
            {t('files.onThisPhone', { tracks: tn('common.tracks', files.length) })}
            {` · ${formatTotal(totalDuration(files), lang)}`}
          </Text>
        ) : undefined
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <MaterialCommunityIcons name="folder-music-outline" size={48} color={colors.onSurfaceVariant} />
          <Text variant="titleMedium" style={{ color: colors.onSurface }}>
            {t('files.emptyTitle')}
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant, textAlign: 'center' }}>
            {t('files.emptyText')}
          </Text>
        </View>
      }
    />
  );
}

// ---------------------------------------------------------------- history

function HistoryView({ notify }: { notify: (m: string) => void }) {
  const { colors } = useAppTheme();
  const { t, tn, lang, locale } = useT();
  const entries = useHistory((s) => s.entries);
  const clear = useHistory((s) => s.clear);
  const [confirm, setConfirm] = useState(false);
  const sections = useMemo(() => groupByDay(entries, undefined, lang), [entries, lang]);

  return (
    <>
      <SectionList
        sections={sections}
        keyExtractor={(e) => e.key}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          entries.length ? (
            <View style={styles.historyBar}>
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant, flex: 1 }}>
                {t('library.onThisPhone', { tracks: tn('common.tracks', entries.length) })}
              </Text>
              <Button onPress={() => setConfirm(true)}>{t('common.clear')}</Button>
            </View>
          ) : undefined
        }
        renderSectionHeader={({ section }) => (
          <Text variant="titleSmall" style={[styles.section, { color: colors.primary }]}>
            {section.title}
          </Text>
        )}
        renderItem={({ item: e }) => (
          <MediaRow
            item={e.item}
            meta={`${e.item.channel} · ${new Date(e.playedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`}
            onPress={() => void playNow([e.item])}
            actions={trackActions(e.item, notify)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="history" size={48} color={colors.onSurfaceVariant} />
            <Text variant="titleMedium" style={{ color: colors.onSurface }}>
              {t('library.noHistoryTitle')}
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant, textAlign: 'center' }}>
              {t('library.noHistoryText')}
            </Text>
            <Button mode="outlined" icon="magnify" onPress={() => router.navigate('/')} style={{ marginTop: 8 }}>
              {t('common.toSearch')}
            </Button>
          </View>
        }
      />

      <Portal>
        <Dialog visible={confirm} onDismiss={() => setConfirm(false)}>
          <Dialog.Title>{t('library.clearHistoryTitle')}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">{t('library.clearHistoryText', { count: entries.length })}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirm(false)}>{t('common.cancel')}</Button>
            <Button
              onPress={() => {
                clear();
                setConfirm(false);
              }}>
              {t('common.clear')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexText: { flex: 1, minWidth: 0, gap: 2 },
  header: { paddingTop: 12, paddingHorizontal: 16, paddingBottom: 8, gap: 12 },
  newRow: { paddingHorizontal: 16, paddingVertical: 8, alignItems: 'flex-start' },
  plRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8, paddingHorizontal: 16 },
  historyBar: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 8 },
  section: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  empty: { padding: 32, gap: 8, alignItems: 'center' },
  filesBar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 16, paddingRight: 8, paddingVertical: 8 },
  footerNote: { textAlign: 'center', padding: 16 },
});
