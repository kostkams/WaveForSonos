import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Thumb } from '@/components/Thumb';
import { takePendingAdd } from '@/playback/trackActions';
import { usePlaylists } from '@/state/playlistStore';
import { useT } from '@/i18n';
import { useAppTheme, withAlpha } from '@/theme/theme';

export default function AddToPlaylistSheet() {
  const { colors } = useAppTheme();
  const { t, tn } = useT();
  const insets = useSafeAreaInsets();
  const [pending] = useState(takePendingAdd);
  const playlists = usePlaylists((s) => s.playlists);
  const addItems = usePlaylists((s) => s.addItems);
  const create = usePlaylists((s) => s.create);
  const [newName, setNewName] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const done = (msg: string) => {
    setResult(msg);
    setTimeout(close, 900);
  };

  const addTo = (id: string, name: string) => {
    if (!pending) return;
    const n = addItems(id, pending.items);
    done(n === 0 ? t('add.already', { name }) : t('add.added', { tracks: tn('common.tracks', n), name }));
  };

  const createWith = () => {
    if (!pending) return;
    const name = (newName ?? '').trim() || t('add.defaultName');
    create(name, pending.items);
    done(t('add.created', { name }));
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.flex}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }]} onPress={close} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { backgroundColor: colors.surfaceContainerLow, paddingBottom: 24 + insets.bottom }]}>
        <View style={styles.handleWrap}>
          <View style={[styles.handle, { backgroundColor: colors.outline }]} />
        </View>
        <Text variant="titleSmall" style={{ color: colors.primary }}>
          {t('add.title')}
        </Text>
        {pending ? (
          <Text variant="bodyMedium" numberOfLines={2} style={{ color: colors.onSurfaceVariant }}>
            {pending.title}
          </Text>
        ) : (
          <Text variant="bodyMedium" style={{ color: colors.error }}>
            {t('add.nothing')}
          </Text>
        )}

        {result ? (
          <View style={styles.result}>
            <MaterialCommunityIcons name="check-circle" size={22} color={colors.primary} />
            <Text variant="bodyLarge" style={{ color: colors.onSurface, flex: 1 }}>
              {result}
            </Text>
          </View>
        ) : (
          <>
            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              {playlists.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => addTo(p.id, p.name)}
                  disabled={!pending}
                  android_ripple={{ color: withAlpha(colors.onSurface, 0.1) }}
                  style={styles.row}
                  accessibilityRole="button"
                  accessibilityLabel={t('add.addTo', { name: p.name })}>
                  <Thumb uri={p.items[0]?.thumbnail} width={56} height={56} radius={12} icon="playlist-music" tint={colors.secondaryContainer} />
                  <View style={{ flex: 1 }}>
                    <Text variant="titleMedium" numberOfLines={1} style={{ color: colors.onSurface }}>
                      {p.name}
                    </Text>
                    <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                      {tn('common.tracks', p.items.length)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>

            {newName === null ? (
              <Button mode="outlined" icon="plus" onPress={() => setNewName('')} disabled={!pending} contentStyle={{ height: 48 }}>
                {t('library.newPlaylist')}
              </Button>
            ) : (
              <View style={{ gap: 10 }}>
                <TextInput
                  mode="outlined"
                  label={t('add.nameLabel')}
                  value={newName}
                  onChangeText={setNewName}
                  autoFocus
                  onSubmitEditing={createWith}
                  returnKeyType="done"
                />
                <Button mode="contained" icon="check" onPress={createWith} contentStyle={{ height: 48 }}>
                  {t('add.createAndAdd')}
                </Button>
              </View>
            )}
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 8, gap: 16 },
  handleWrap: { alignItems: 'center', paddingTop: 8 },
  handle: { width: 32, height: 4, borderRadius: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16 },
});
