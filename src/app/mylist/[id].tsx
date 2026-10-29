import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Button, Dialog, IconButton, Menu, Portal, Snackbar, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MediaRow } from '@/components/MediaRow';
import { enqueue, playNow } from '@/playback/controller';
import { trackActions } from '@/playback/trackActions';
import { shuffled, totalDuration, usePlaylists } from '@/state/playlistStore';
import { useT } from '@/i18n';
import { useAppTheme } from '@/theme/theme';
import { formatDuration, formatTotal } from '@/util/format';

export default function MyPlaylistScreen() {
  const { colors } = useAppTheme();
  const { t, tn, lang } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pl = usePlaylists((s) => s.playlists.find((p) => p.id === id));
  const { rename, remove, removeAt, move } = usePlaylists.getState();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!pl) {
    return (
      <SafeAreaView style={[styles.flex, styles.center, { backgroundColor: colors.background }]}>
        <Text variant="titleMedium" style={{ color: colors.onSurface }}>
          {t('mylist.notFound')}
        </Text>
        <Button onPress={() => router.back()}>{t('common.back')}</Button>
      </SafeAreaView>
    );
  }

  const empty = pl.items.length === 0;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <IconButton icon="arrow-left" onPress={() => router.back()} accessibilityLabel={t('common.back')} />
        <View style={styles.flex}>
          <Text variant="titleLarge" numberOfLines={1} style={{ color: colors.onSurface }}>
            {pl.name}
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
            {tn('common.tracks', pl.items.length)}
            {empty ? '' : ` · ${formatTotal(totalDuration(pl.items), lang)}`}
          </Text>
        </View>
        <Menu visible={menu} onDismiss={() => setMenu(false)} anchor={<IconButton icon="dots-vertical" onPress={() => setMenu(true)} accessibilityLabel={t('mylist.options')} />}>
          <Menu.Item
            leadingIcon="pencil-outline"
            title={t('mylist.rename')}
            onPress={() => {
              setMenu(false);
              setRenaming(pl.name);
            }}
          />
          <Menu.Item
            leadingIcon="delete-outline"
            title={t('mylist.delete')}
            onPress={() => {
              setMenu(false);
              setConfirmDelete(true);
            }}
          />
        </Menu>
      </View>

      <View style={styles.actions}>
        <Button
          mode="contained"
          icon="play"
          disabled={empty}
          onPress={() => {
            void playNow(pl.items);
            router.push('/player');
          }}>
          {t('common.play')}
        </Button>
        <Button
          mode="contained-tonal"
          icon="shuffle-variant"
          disabled={empty}
          onPress={() => {
            void playNow(shuffled(pl.items));
            router.push('/player');
          }}>
          {t('common.shuffle')}
        </Button>
        <IconButton
          icon="playlist-plus"
          mode="outlined"
          disabled={empty}
          onPress={() => setMessage(t('track.addedManyToQueue', { count: enqueue(pl.items) }))}
          accessibilityLabel={t('mylist.appendAll')}
        />
      </View>

      <FlatList
        data={pl.items}
        keyExtractor={(i) => i.id}
        renderItem={({ item, index }) => (
          <MediaRow
            item={item}
            meta={[item.channel, formatDuration(item.durationSec)].filter(Boolean).join(' · ')}
            onPress={() => void playNow(pl.items.slice(index))}
            actions={trackActions(item, setMessage, [
              { label: t('track.moveUp'), icon: 'arrow-up', disabled: index === 0, onPress: () => move(pl.id, index, index - 1) },
              { label: t('track.moveDown'), icon: 'arrow-down', disabled: index === pl.items.length - 1, onPress: () => move(pl.id, index, index + 1) },
              {
                label: t('mylist.remove'),
                icon: 'playlist-remove',
                onPress: () => {
                  removeAt(pl.id, index);
                  setMessage(t('mylist.removed'));
                },
              },
            ])}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="playlist-plus" size={48} color={colors.onSurfaceVariant} />
            <Text variant="titleMedium" style={{ color: colors.onSurface }}>
              {t('mylist.emptyTitle')}
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant, textAlign: 'center' }}>
              {t('mylist.emptyText')}
            </Text>
            <Button mode="outlined" icon="magnify" onPress={() => router.navigate('/')} style={{ marginTop: 8 }}>
              {t('common.toSearch')}
            </Button>
          </View>
        }
      />

      <Portal>
        <Dialog visible={renaming !== null} onDismiss={() => setRenaming(null)}>
          <Dialog.Title>{t('mylist.renameTitle')}</Dialog.Title>
          <Dialog.Content>
            <TextInput mode="outlined" label={t('common.name')} value={renaming ?? ''} onChangeText={setRenaming} autoFocus />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRenaming(null)}>{t('common.cancel')}</Button>
            <Button
              onPress={() => {
                if (renaming) rename(pl.id, renaming);
                setRenaming(null);
              }}>
              {t('common.save')}
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={confirmDelete} onDismiss={() => setConfirmDelete(false)}>
          <Dialog.Title>{t('mylist.deleteTitle', { name: pl.name })}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">{t('mylist.deleteText')}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
            <Button
              onPress={() => {
                setConfirmDelete(false);
                remove(pl.id);
                router.back();
              }}>
              {t('common.delete')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!message} onDismiss={() => setMessage(null)} duration={2500}>
        {message ?? ''}
      </Snackbar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 8, gap: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  empty: { padding: 32, gap: 8, alignItems: 'center' },
});
