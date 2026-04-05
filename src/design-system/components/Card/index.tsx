import React from 'react';
import { Pressable, PressableProps, View, ViewProps, StyleSheet } from 'react-native';
import { colors, spacing, borderRadius, shadows } from '../../tokens';

export type CardVariant = 'elevated' | 'outlined' | 'filled' | 'flat';

interface BaseCardProps {
  variant?: CardVariant;
  padding?: number;
  radius?: number;
  children: React.ReactNode;
}

export interface CardProps extends BaseCardProps, Omit<PressableProps, 'style' | 'children'> {
  onPress?: () => void;
}

export interface CardViewProps extends BaseCardProps, Omit<ViewProps, 'style' | 'children'> {}

const variantStyle: Record<CardVariant, {
  backgroundColor: string;
  borderWidth: number;
  borderColor: string;
  shadow: (typeof shadows)[keyof typeof shadows];
}> = {
  elevated: {
    backgroundColor: colors.bg.default,
    borderWidth:     0,
    borderColor:     'transparent',
    shadow:          shadows.sm,
  },
  outlined: {
    backgroundColor: colors.bg.default,
    borderWidth:     1,
    borderColor:     colors.border.default,
    shadow:          shadows.none,
  },
  filled: {
    backgroundColor: colors.bg.subtle,
    borderWidth:     0,
    borderColor:     'transparent',
    shadow:          shadows.none,
  },
  flat: {
    backgroundColor: 'transparent',
    borderWidth:     0,
    borderColor:     'transparent',
    shadow:          shadows.none,
  },
};

export function Card({
  variant = 'elevated',
  padding = spacing[5],
  radius = borderRadius.xl,
  children,
  onPress,
  ...props
}: CardProps) {
  const vs = variantStyle[variant];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.base,
          vs.shadow,
          {
            backgroundColor: pressed
              ? colors.interactive.pressed
              : vs.backgroundColor,
            borderWidth:  vs.borderWidth,
            borderColor:  vs.borderColor,
            borderRadius: radius,
            padding,
          },
        ]}
        {...props}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.base,
        vs.shadow,
        {
          backgroundColor: vs.backgroundColor,
          borderWidth:     vs.borderWidth,
          borderColor:     vs.borderColor,
          borderRadius:    radius,
          padding,
        },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
  },
});
