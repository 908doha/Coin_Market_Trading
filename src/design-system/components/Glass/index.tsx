import React from 'react';
import { View, Platform, StyleSheet, ViewStyle } from 'react-native';

interface GlassViewProps {
  children: React.ReactNode;
  style?:   ViewStyle | ViewStyle[];
  blur?:    number;
  intensity?: 'low' | 'medium' | 'high';
}

// Toss-style light cards — no borders, white background
const intensityMap = {
  low:    { bg: '#FFFFFF', border: 'transparent' },
  medium: { bg: '#FFFFFF', border: 'transparent' },
  high:   { bg: '#FFFFFF', border: 'transparent' },
};

export function GlassView({ children, style, intensity = 'medium' }: GlassViewProps) {
  const { bg, border } = intensityMap[intensity];

  return (
    <View style={[
      {
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
      },
      style,
    ]}>
      {children}
    </View>
  );
}

interface GlassCardProps extends GlassViewProps {
  radius?: number;
  padding?: number;
}

export function GlassCard({ children, style, intensity = 'medium', radius = 20, padding = 20 }: GlassCardProps) {
  return (
    <GlassView
      intensity={intensity}
      style={[{ borderRadius: radius, padding }, style as ViewStyle]}
    >
      {children}
    </GlassView>
  );
}
