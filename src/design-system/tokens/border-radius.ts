/**
 * Border Radius Tokens — Toss-style rounded corners
 */

export const borderRadius = {
  none:  0,
  xs:    4,
  sm:    8,
  md:    12,
  lg:    16,
  xl:    20,
  '2xl': 24,
  '3xl': 28,
  '4xl': 32,
  full:  9999,
} as const;

/**
 * Component radius mappings (Toss SEED conventions)
 */
export const componentRadius = {
  button: {
    sm: borderRadius.md,    // 12
    md: borderRadius.lg,    // 16
    lg: borderRadius.xl,    // 20
  },
  card:        borderRadius.xl,    // 20
  cardSmall:   borderRadius.lg,    // 16
  input:       borderRadius.md,    // 12
  chip:        borderRadius.full,  // pill shape
  badge:       borderRadius.full,  // pill shape
  avatar:      borderRadius.full,
  bottomSheet: borderRadius['2xl'], // 24 — top corners
  modal:       borderRadius['2xl'],
  toast:       borderRadius.lg,
  tooltip:     borderRadius.sm,
} as const;

export type BorderRadiusToken = typeof borderRadius;
