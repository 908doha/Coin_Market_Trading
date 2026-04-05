import React, { useState } from 'react';
import {
  TextInput,
  TextInputProps,
  View,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Text } from '../Text';
import { colors, spacing, borderRadius, textStyles } from '../../tokens';

export type InputSize = 'sm' | 'md' | 'lg';
export type InputVariant = 'default' | 'filled' | 'underline';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  hint?: string;
  error?: string;
  size?: InputSize;
  variant?: InputVariant;
  leftIcon?: React.ReactNode;
  rightElement?: React.ReactNode;
  disabled?: boolean;
}

const sizeConfig: Record<InputSize, { height: number; fontSize: number; paddingH: number }> = {
  sm: { height: 44, fontSize: textStyles.body2.fontSize,  paddingH: spacing[3] },
  md: { height: 52, fontSize: textStyles.body1.fontSize,  paddingH: spacing[4] },
  lg: { height: 56, fontSize: textStyles.body1.fontSize,  paddingH: spacing[4] },
};

export function Input({
  label,
  hint,
  error,
  size = 'md',
  variant = 'default',
  leftIcon,
  rightElement,
  disabled = false,
  ...props
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const sc = sizeConfig[size];

  const getBorderColor = () => {
    if (error)   return colors.negative.default;
    if (focused) return colors.border.focus;
    return colors.border.default;
  };

  const getBgColor = () => {
    if (disabled) return colors.interactive.disabled;
    if (variant === 'filled') return colors.bg.subtle;
    return colors.bg.default;
  };

  return (
    <View style={styles.wrapper}>
      {label && (
        <Text variant="label1" color={colors.text.secondary} style={styles.label}>
          {label}
        </Text>
      )}

      <View
        style={[
          styles.container,
          {
            height:          variant === 'underline' ? undefined : sc.height,
            paddingVertical: variant === 'underline' ? spacing[2] : 0,
            paddingHorizontal: sc.paddingH,
            backgroundColor:   getBgColor(),
            borderRadius:      variant === 'underline' ? 0 : borderRadius.md,
            borderWidth:       variant === 'underline' ? 0 : (focused ? 2.5 : 1.5),
            borderBottomWidth: variant === 'underline' ? (focused ? 2.5 : 1.5) : (focused ? 2.5 : 1.5),
            borderColor:       getBorderColor(),
          },
        ]}
      >
        {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}

        <TextInput
          style={[
            styles.input,
            {
              fontSize: sc.fontSize,
              color: disabled ? colors.text.disabled : colors.text.primary,
            },
          ]}
          placeholderTextColor={colors.text.placeholder}
          editable={!disabled}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          {...props}
        />

        {rightElement && <View style={styles.rightElement}>{rightElement}</View>}
      </View>

      {(hint || error) && (
        <Text
          variant="caption1"
          color={error ? colors.negative.text : colors.text.tertiary}
          style={styles.helperText}
        >
          {error ?? hint}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  label: {
    marginBottom: spacing[1.5],
  },
  container: {
    flexDirection: 'row',
    alignItems:    'center',
  },
  leftIcon: {
    marginRight: spacing[2],
  },
  input: {
    flex:                   1,
    includeFontPadding:     false,
    textAlignVertical:      'center',
    padding:                0,
    fontWeight:             '400',
  },
  rightElement: {
    marginLeft: spacing[2],
  },
  helperText: {
    marginTop: spacing[1],
  },
});
