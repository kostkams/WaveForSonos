import Slider from '@react-native-community/slider';
import type { ViewStyle } from 'react-native';

import { useAppTheme } from '@/theme/theme';

type Props = {
  value: number;
  min?: number;
  max: number;
  onChange?: (v: number) => void;
  onCommit: (v: number) => void;
  disabled?: boolean;
  label: string;
  style?: ViewStyle;
};

export function M3Slider({ value, min = 0, max, onChange, onCommit, disabled, label, style }: Props) {
  const { colors } = useAppTheme();
  return (
    <Slider
      style={[{ height: 44, flex: 1 }, style]}
      value={value}
      minimumValue={min}
      maximumValue={Math.max(max, min + 1)}
      onValueChange={onChange}
      onSlidingComplete={onCommit}
      disabled={disabled}
      minimumTrackTintColor={disabled ? colors.outline : colors.primary}
      maximumTrackTintColor={disabled ? colors.surfaceContainerHighest : colors.primaryContainer}
      thumbTintColor={disabled ? colors.outline : colors.primary}
      accessibilityLabel={label}
    />
  );
}
