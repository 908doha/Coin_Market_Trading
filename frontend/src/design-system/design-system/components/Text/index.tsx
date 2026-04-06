import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';
import { textStyles, colors } from '../../tokens';
import type { TextStyleVariant } from '../../tokens';

export interface TextProps extends RNTextProps {
  variant?: TextStyleVariant;
  color?: string;
  align?: 'left' | 'center' | 'right';
}

export function Text({
  variant = 'body1',
  color,
  align,
  style,
  ...props
}: TextProps) {
  return (
    <RNText
      style={[
        styles.base,
        textStyles[variant] as any,
        { color: color ?? colors.text.primary },
        align ? { textAlign: align } : undefined,
        style,
      ]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});
