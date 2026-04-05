import React from 'react';
import { View, Platform, StyleSheet, ViewStyle } from 'react-native';

interface GlassViewProps {
  children: React.ReactNode;
  style?:   ViewStyle | ViewStyle[];
  blur?:    number;
  intensity?: 'low' | 'medium' | 'high';
}

const intensityMap = {
  low:    { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)' },
  medium: { bg: 'rgba(255,255,255,0.07)', border: 'rgba(255,255,255,0.12)' },
  high:   { bg: 'rgba(255,255,255,0.11)', border: 'rgba(255,255,255,0.18)' },
};

export function GlassView({ children, style, blur = 20, intensity = 'medium' }: GlassViewProps) {
  const { bg, border } = intensityMap[intensity];

  const webStyle = Platform.OS === 'web'
    ? { backdropFilter: `blur(${blur}px)`, WebkitBackdropFilter: `blur(${blur}px)` } as any
    : {};

  return (
    <View style={[{ backgroundColor: bg, borderWidth: 1, borderColor: border }, webStyle, style]}>
      {children}
    </View>
  );
}

interface GlassCardProps extends GlassViewProps {
  radius?: number;
  padding?: number;
}

export function GlassCard({ children, style, blur, intensity = 'medium', radius = 20, padding = 20 }: GlassCardProps) {
  return (
    <GlassView
      blur={blur}
      intensity={intensity}
      style={[{ borderRadius: radius, padding }, style as ViewStyle]}
    >
      {children}
    </GlassView>
  );
}
