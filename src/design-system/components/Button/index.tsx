import React from 'react';
import {
  Pressable,
  PressableProps,
  StyleSheet,
  ActivityIndicator,
  View,
} from 'react-native';
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
}

const sizeConfig: Record<ButtonSize, {
  height: number;
  paddingHorizontal: number;
  radius: number;
  textVariant: keyof typeof textStyles;
}> = {
  sm: { height: 36, paddingHorizontal: spacing[3], radius: borderRadius.md,  textVariant: 'label2' },
  md: { height: 48, paddingHorizontal: spacing[5], radius: borderRadius.lg,  textVariant: 'label1Bold' },
  lg: { height: 56, paddingHorizontal: spacing[5], radius: borderRadius.xl,  textVariant: 'body1Medium' },
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
  ...props
}: ButtonProps) {
  const sc = sizeConfig[size];
  const vc = variantConfig[variant];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          height:            sc.height,
          paddingHorizontal: sc.paddingHorizontal,
          borderRadius:      sc.radius,
          backgroundColor:   isDisabled
            ? vc.bgDisabled
            : pressed ? vc.bgPressed : vc.bg,
          borderWidth:       vc.borderColor ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor:       vc.borderColor ?? 'transparent',
          alignSelf:         fullWidth ? 'stretch' : 'flex-start',
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
            variant={sc.textVariant}
            color={isDisabled ? vc.textDisabled : vc.textColor}
          >
            {label}
          </Text>
          {rightIcon && <View style={styles.iconRight}>{rightIcon}</View>}
        </View>
      )}
    </Pressable>
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
  iconLeft: {
    marginRight: spacing[1.5],
  },
  iconRight: {
    marginLeft: spacing[1.5],
  },
});
