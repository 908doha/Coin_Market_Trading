import React from 'react';
import { View, Platform, StyleSheet, ViewStyle } from 'react-native';

interface GlassViewProps {
  children: React.ReactNode;
  style?:   ViewStyle | ViewStyle[];
  blur?:    number;
  intensity?: 'low' | 'medium' | 'high';
}

// Toss-style light cards — intensity maps to elevation level
const intensityMap = {
  low:    { bg: '#FFFFFF', border: '#F0F0F0' },
  medium: { bg: '#FFFFFF', border: '#EBEBEB' },
  high:   { bg: '#FFFFFF', border: '#E2E2E2' },
};

export function GlassView({ children, style, intensity = 'medium' }: GlassViewProps) {
  const { bg, border } = intensityMap[intensity];

  return (
    <View style={[
      {
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 2,
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
