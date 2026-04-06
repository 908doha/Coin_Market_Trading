import React from 'react';
import { View, ViewStyle, StyleSheet } from 'react-native';
import { Text } from '../Text';
import { colors, spacing, borderRadius } from '../../tokens';

export type BadgeVariant = 'default' | 'positive' | 'negative' | 'cautious' | 'informative';
export type BadgeSize = 'sm' | 'md' | 'lg';

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  size?: BadgeSize;
  style?: ViewStyle;
}

const variantConfig: Record<BadgeVariant, { bg: string; textColor: string }> = {
  default:     { bg: colors.bg.elevated,      textColor: colors.text.secondary },
  positive:    { bg: colors.positive.subtle,  textColor: colors.positive.text  },
  negative:    { bg: colors.negative.subtle,  textColor: colors.negative.text  },
  cautious:    { bg: colors.cautious.subtle,  textColor: colors.cautious.text  },
  informative: { bg: colors.informative.subtle, textColor: colors.informative.text },
};

const sizeConfig: Record<BadgeSize, {
  paddingH: number;
  paddingV: number;
  textVariant: 'caption2' | 'caption1Medium' | 'label2';
}> = {
  sm: { paddingH: spacing[1.5], paddingV: 2,          textVariant: 'caption2' },
  md: { paddingH: spacing[2],   paddingV: spacing[0.5], textVariant: 'caption1Medium' },
  lg: { paddingH: spacing[2.5], paddingV: spacing[1],  textVariant: 'label2' },
};

export function Badge({ label, variant = 'default', size = 'md', style }: BadgeProps) {
  const vc = variantConfig[variant];
  const sc = sizeConfig[size];

  return (
    <View
      style={[
        styles.base,
        {
          paddingHorizontal: sc.paddingH,
          paddingVertical:   sc.paddingV,
          backgroundColor:   vc.bg,
          borderRadius:      borderRadius.full,
        },
        style,
      ]}
    >
      <Text variant={sc.textVariant} color={vc.textColor}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf:      'flex-start',
    alignItems:     'center',
    justifyContent: 'center',
  },
});
