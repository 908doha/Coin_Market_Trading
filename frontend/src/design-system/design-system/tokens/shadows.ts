/**
 * Shadow & Elevation Tokens
 * Cross-platform: uses shadowColor/shadowOffset for iOS, elevation for Android
 */

import { Platform } from 'react-native';

export type ShadowStyle = {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
};

const createShadow = (
  offsetY: number,
  blur: number,
  opacity: number,
  elevation: number,
): ShadowStyle => ({
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: offsetY },
  shadowOpacity: opacity,
  shadowRadius: blur,
  elevation,
});

export const shadows = {
  none: {
    shadowColor:   'transparent',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius:  0,
    elevation:     0,
  } as ShadowStyle,

  xs:  createShadow(1, 2,  0.04, 1),
  sm:  createShadow(2, 4,  0.06, 2),
  md:  createShadow(4, 8,  0.08, 4),
  lg:  createShadow(8, 16, 0.10, 8),
  xl:  createShadow(12, 24, 0.12, 12),
  '2xl': createShadow(16, 32, 0.14, 16),
} as const;

/**
 * Card elevation levels (semantic)
 */
export const elevation = {
  flat:    shadows.none,
  card:    shadows.sm,
  raised:  shadows.md,
  overlay: shadows.lg,
  modal:   shadows.xl,
  drawer:  shadows['2xl'],
} as const;

export type ShadowToken = keyof typeof shadows;
