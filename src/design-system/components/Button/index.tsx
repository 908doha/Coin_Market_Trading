import React from 'react';
import {
  Pressable,
  PressableProps,
  StyleSheet,
  ActivityIndicator,
  View,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Text } from '../Text';
import { colors, spacing, borderRadius, textStyles } from '../../tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  label: string;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  style?: import('react-native').ViewStyle;
}

const SPRING = { damping: 18, stiffness: 280, mass: 0.7 };

const sizeConfig: Record<ButtonSize, {
  height: number;
  paddingHorizontal: number;
  radius: number;
  fontSize: number;
  fontWeight: '400' | '500' | '600' | '700' | '800';
}> = {
  sm: { height: 36, paddingHorizontal: spacing[3], radius: borderRadius.md,  fontSize: 13, fontWeight: '600' },
  md: { height: 48, paddingHorizontal: spacing[5], radius: borderRadius.lg,  fontSize: 15, fontWeight: '600' },
  lg: { height: 56, paddingHorizontal: spacing[5], radius: borderRadius.xl,  fontSize: 16, fontWeight: '700' },
};

const variantConfig: Record<ButtonVariant, {
  bg: string;
  bgPressed: string;
  bgDisabled: string;
  textColor: string;
  textDisabled: string;
  borderColor?: string;
}> = {
  primary: {
    bg:         colors.primary.default,
    bgPressed:  colors.primary.subtle,
    bgDisabled: colors.interactive.disabled,
    textColor:  colors.primary.foreground,
    textDisabled: colors.text.disabled,
  },
  secondary: {
    bg:         colors.bg.elevated,
    bgPressed:  colors.bg.subtle,
    bgDisabled: colors.interactive.disabled,
    textColor:  colors.text.primary,
    textDisabled: colors.text.disabled,
  },
  outline: {
    bg:          'transparent',
    bgPressed:   colors.interactive.pressed,
    bgDisabled:  'transparent',
    textColor:   colors.text.primary,
    textDisabled: colors.text.disabled,
    borderColor: colors.border.strong,
  },
  ghost: {
    bg:          'transparent',
    bgPressed:   colors.interactive.pressed,
    bgDisabled:  'transparent',
    textColor:   colors.text.primary,
    textDisabled: colors.text.disabled,
  },
  danger: {
    bg:          colors.negative.default,
    bgPressed:   colors.negative.text,
    bgDisabled:  colors.interactive.disabled,
    textColor:   colors.negative.foreground,
    textDisabled: colors.text.disabled,
  },
};

export function Button({
  variant = 'primary',
  size = 'md',
  label,
  loading = false,
  disabled = false,
  fullWidth = false,
  leftIcon,
  rightIcon,
  style,
  ...props
}: ButtonProps) {
  const sc = sizeConfig[size];
  const vc = variantConfig[variant];
  const isDisabled = disabled || loading;

  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    alignSelf: fullWidth ? 'stretch' as const : 'flex-start' as const,
  }));

  return (
    <Animated.View style={[animStyle, style]}>
      <Pressable
        disabled={isDisabled}
        onPressIn={() => {
          if (!isDisabled) scale.value = withSpring(0.95, SPRING);
        }}
        onPressOut={() => {
          scale.value = withSpring(1, SPRING);
        }}
        style={({ pressed }) => [
          styles.base,
          {
            height:            sc.height,
            paddingHorizontal: sc.paddingHorizontal,
            borderRadius:      sc.radius,
            backgroundColor:   isDisabled
              ? vc.bgDisabled
              : pressed ? vc.bgPressed : vc.bg,
            borderWidth:       vc.borderColor ? 1.5 : 0,
            borderColor:       vc.borderColor ?? 'transparent',
          },
        ]}
        {...props}
      >
        {loading ? (
          <ActivityIndicator
            size="small"
            color={isDisabled ? colors.text.disabled : vc.textColor}
          />
        ) : (
          <View style={styles.content}>
            {leftIcon && <View style={styles.iconLeft}>{leftIcon}</View>}
            <Text
              style={{
                fontSize:   sc.fontSize,
                fontWeight: isDisabled ? '400' : sc.fontWeight,
                color:      isDisabled ? vc.textDisabled : vc.textColor,
              }}
            >
              {label}
            </Text>
            {rightIcon && <View style={styles.iconRight}>{rightIcon}</View>}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems:     'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems:    'center',
  },
  iconLeft:  { marginRight: spacing[1.5] },
  iconRight: { marginLeft:  spacing[1.5] },
});
