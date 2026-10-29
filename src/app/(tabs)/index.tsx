import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { Button, Chip, IconButton, Searchbar, Snackbar, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MediaRow } from '@/components/MediaRow';
import { Native, type MediaItem, type SearchFilter } from '@/native';
import { playNow } from '@/playback/controller';
import { errorText } from '@/playback/speakers';
import { trackActions } from '@/playback/trackActions';
import { selectionLabel, useSpeakers } from '@/state/speakerStore';
import { useT } from '@/i18n';
import { useAppTheme } from '@/theme/theme';
import { parseYouTubeLink } from '@/youtube/links';

const FILTERS: { id: SearchFilter; label: 'search.all' | 'search.videos' | 'search.playlists' }[] = [
  { id: 'all', label: 'search.all' },
  { id: 'videos', label: 'search.videos' },
  { id: 'playlists', label: 'search.playlists' },
];

export default function SearchScreen() {
  const { colors } = useAppTheme();
  const { t } = useT();
  const groups = useSpeakers((s) => s.groups);
  const selected = useSpeakers((s) => s.selected);

  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [filter, setFilter] = useState<SearchFilter>('all');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const reqId = useRef(0);

  const runSearch = useCallback(async (q: string, f: SearchFilter) => {
    const text = q.trim();
    if (!text) return;
    const link = parseYouTubeLink(text);
    if (link) {
      router.push({ pathname: '/share', params: { text } });
      return;
    }
    const id = ++reqId.current;
    setSubmitted(text);
    setLoading(true);
    setItems([]);
    setNextPage(null);
    try {
      const page = await Native.search(text, f, null);
      if (id !== reqId.current) return;
      setItems(page.items);
      setNextPage(page.nextPage);
    } catch (e) {
      if (id === reqId.current) setMessage(t('search.failed', { error: errorText(e) }));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
    // Only called from handlers, never from an effect, so a new `t` can't trigger a re-search.
  }, [t]);

  const loadMore = useCallback(async () => {
    if (!nextPage || loading || !submitted) return;
    const id = reqId.current;
    setLoading(true);
    try {
      const page = await Native.search(submitted, filter, nextPage);
      if (id !== reqId.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.items.filter((p) => !seen.has(p.id))];
      });
      setNextPage(page.nextPage);
    } catch {
      if (id === reqId.current) setNextPage(null);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [nextPage, loading, submitted, filter]);

  const paste = async () => {
    const text = (await Clipboard.getStringAsync()).trim();
    if (!text) {
      setMessage(t('search.clipboardEmpty'));
      return;
    }
    setQuery(text);
    void runSearch(text, filter);
  };

  const onPress = (item: MediaItem) => {
    if (item.type === 'playlist') router.push({ pathname: '/playlist/[id]', params: { id: item.id } });
    else void playNow([item]);
  };


  return (
    <SafeAreaView edges={['top']} style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={styles.top}>
        <View style={styles.searchRow}>
          <Searchbar
            style={[styles.flex, { backgroundColor: colors.surfaceContainerHigh }]}
            placeholder={t('search.placeholder')}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void runSearch(query, filter)}
            returnKeyType="search"
            traileringIcon="content-paste"
            traileringIconAccessibilityLabel={t('search.pasteLabel')}
            onTraileringIconPress={() => void paste()}
            onClearIconPress={() => {
              // Invalidate in-flight search / loadMore so they can't refill the cleared list.
              reqId.current++;
              setItems([]);
              setSubmitted('');
              setNextPage(null);
              setLoading(false);
            }}
          />
          <IconButton icon="cog-outline" onPress={() => router.push('/settings')} accessibilityLabel={t('search.settings')} style={styles.cog} />
        </View>

        <View style={styles.chips}>
          <Chip
            icon="speaker-multiple"
            onPress={() => router.navigate('/speakers')}
            style={{ backgroundColor: colors.primaryContainer }}
            textStyle={{ color: colors.onPrimaryContainer }}>
            {selectionLabel(groups, selected)}
          </Chip>
        </View>

        <View style={styles.chips}>
          {FILTERS.map((f) => (
            <Chip
              key={f.id}
              mode={filter === f.id ? 'flat' : 'outlined'}
              selected={filter === f.id}
              showSelectedCheck
              style={filter === f.id ? { backgroundColor: colors.selected } : undefined}
              onPress={() => {
                setFilter(f.id);
                if (submitted) void runSearch(submitted, f.id);
              }}>
              {t(f.label)}
            </Chip>
          ))}
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => `${i.type}-${i.id}`}
        renderItem={({ item }) => <MediaRow item={item} onPress={() => onPress(item)} actions={trackActions(item, setMessage)} />}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.6}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          submitted && items.length ? (
            <Text variant="labelLarge" style={[styles.header, { color: colors.onSurfaceVariant }]}>
              {t('search.resultsFor', { query: submitted })}
            </Text>
          ) : undefined
        }
        ListEmptyComponent={
          loading ? undefined : (
            <View style={styles.empty}>
              <Text variant="titleMedium" style={{ color: colors.onSurface, textAlign: 'center' }}>
                {submitted ? t('search.nothingFound') : t('search.emptyTitle')}
              </Text>
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant, textAlign: 'center' }}>
                {t('search.emptyText')}
              </Text>
              {!submitted ? (
                <Button mode="outlined" icon="content-paste" onPress={() => void paste()} style={{ marginTop: 8 }}>
                  {t('search.pasteLink')}
                </Button>
              ) : null}
            </View>
          )
        }
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
  top: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cog: { marginRight: -8 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  empty: { padding: 32, gap: 8, alignItems: 'center' },
});
