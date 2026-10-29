import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';

import { useAppTheme } from '@/theme/theme';

type Props = {
  uri: string | null | undefined;
  width: number;
  height: number;
  radius?: number;
  badge?: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  tint?: string;
  style?: ViewStyle;
};

/** Video thumbnail with placeholder tile and optional duration badge. */
export function Thumb({ uri, width, height, radius = 12, badge, icon = 'music-note', tint, style }: Props) {
  const { colors } = useAppTheme();
  return (
    <View style={[{ width, height, borderRadius: radius, backgroundColor: tint ?? colors.primaryContainer, overflow: 'hidden' }, styles.center, style]}>
      <MaterialCommunityIcons name={icon} size={Math.min(width, height) * 0.4} color={colors.onSurfaceVariant} />
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : null}
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    backgroundColor: 'rgba(20,12,10,0.82)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '500' },
});
