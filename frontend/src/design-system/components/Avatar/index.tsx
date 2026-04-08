import React from 'react';
import { View, Image, StyleSheet, ViewStyle } from 'react-native';
import { Text } from '../Text';
import { colors, borderRadius } from '../../tokens';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  src?: string;
  name?: string;
  size?: AvatarSize;
  style?: ViewStyle;
}

const sizeConfig: Record<AvatarSize, { diameter: number; textVariant: 'caption2' | 'caption1' | 'label1' | 'heading2' | 'heading1' }> = {
  xs: { diameter: 24, textVariant: 'caption2'  },
  sm: { diameter: 32, textVariant: 'caption1'  },
  md: { diameter: 40, textVariant: 'label1'    },
  lg: { diameter: 56, textVariant: 'heading2'  },
  xl: { diameter: 72, textVariant: 'heading1'  },
};

function getInitials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

function getAvatarBg(name: string): string {
  const hues = [
    colors.bg.elevated,
    colors.primary.subtle,
    colors.positive.subtle,
    colors.informative.subtle,
    colors.cautious.subtle,
  ];
  const index = name.charCodeAt(0) % hues.length;
  return hues[index];
}

export function Avatar({ src, name = '?', size = 'md', style }: AvatarProps) {
  const sc = sizeConfig[size];
  const d = sc.diameter;

  return (
    <View
      style={[
        styles.base,
        {
          width:           d,
          height:          d,
          borderRadius:    d / 2,
          backgroundColor: src ? 'transparent' : getAvatarBg(name),
        },
        style,
      ]}
    >
      {src ? (
        <Image
          source={{ uri: src }}
          style={{ width: d, height: d, borderRadius: d / 2 }}
        />
      ) : (
        <Text variant={sc.textVariant} color={colors.text.secondary}>
          {getInitials(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems:     'center',
    justifyContent: 'center',
    overflow:       'hidden',
  },
});
