import React from 'react';
import { Pressable, PressableProps, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import { colors, spacing, borderRadius } from '../../tokens';

export type ChipVariant = 'default' | 'selected' | 'positive' | 'negative' | 'cautious';
export type ChipSize = 'sm' | 'md';

export interface ChipProps extends Omit<PressableProps, 'style'> {
  label: string;
  variant?: ChipVariant;
  size?: ChipSize;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  selected?: boolean;
}

const sizeConfig: Record<ChipSize, { height: number; paddingH: number; textVariant: 'label2' | 'label1' }> = {
  sm: { height: 28, paddingH: spacing[2],   textVariant: 'label2' },
  md: { height: 34, paddingH: spacing[3],   textVariant: 'label1' },
};

const variantConfig: Record<ChipVariant, { bg: string; textColor: string; borderColor: string }> = {
  default:  { bg: colors.bg.elevated,        textColor: colors.text.secondary, borderColor: colors.border.default  },
  selected: { bg: colors.primary.default,    textColor: colors.text.inverse,   borderColor: colors.primary.default },
  positive: { bg: colors.positive.subtle,    textColor: colors.positive.text,  borderColor: colors.positive.default },
  negative: { bg: colors.negative.subtle,    textColor: colors.negative.text,  borderColor: colors.negative.default },
  cautious: { bg: colors.cautious.subtle,    textColor: colors.cautious.text,  borderColor: colors.cautious.default },
};

export function Chip({
  label,
  variant = 'default',
  size = 'md',
  leftIcon,
  rightIcon,
  selected,
  ...props
}: ChipProps) {
  const resolvedVariant = selected ? 'selected' : variant;
  const sc = sizeConfig[size];
  const vc = variantConfig[resolvedVariant];

  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        {
          height:           sc.height,
          paddingHorizontal: sc.paddingH,
          borderRadius:     borderRadius.full,
          backgroundColor:  pressed ? colors.interactive.pressed : vc.bg,
          borderWidth:      1,
          borderColor:      vc.borderColor,
        },
      ]}
      {...props}
    >
      <View style={styles.content}>
        {leftIcon && <View style={styles.iconLeft}>{leftIcon}</View>}
        <Text variant={sc.textVariant} color={vc.textColor}>{label}</Text>
        {rightIcon && <View style={styles.iconRight}>{rightIcon}</View>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems:     'center',
    justifyContent: 'center',
    alignSelf:      'flex-start',
  },
  content: {
    flexDirection: 'row',
    alignItems:    'center',
  },
  iconLeft: { marginRight: spacing[1] },
  iconRight: { marginLeft: spacing[1] },
});
