/**
 * Typography Tokens — Toss SEED-inspired
 *
 * Font: Pretendard (Korean) / SF Pro (iOS system fallback)
 * Scale follows Korean mobile UX conventions
 */

export const fontFamily = {
  sans: [
    'PretendardVariable',
    'Pretendard',
    '-apple-system',
    'BlinkMacSystemFont',
    'SF Pro Display',
    'SF Pro Text',
    'Helvetica Neue',
    'Arial',
    'sans-serif',
  ].join(', '),
  mono: [
    'SF Mono',
    'Fira Code',
    'Consolas',
    'monospace',
  ].join(', '),
} as const;

export const fontWeight = {
  regular:   '400',
  medium:    '500',
  semiBold:  '600',
  bold:      '700',
  extraBold: '800',
} as const;

export const fontSize = {
  '3xs': 10,
  '2xs': 11,
  xs:    12,
  sm:    13,
  md:    14,
  base:  15,
  lg:    16,
  xl:    17,
  '2xl': 18,
  '3xl': 20,
  '4xl': 22,
  '5xl': 24,
  '6xl': 28,
  '7xl': 32,
  '8xl': 36,
  '9xl': 40,
} as const;

export const lineHeight = {
  tight:    1.2,
  snug:     1.35,
  normal:   1.5,
  relaxed:  1.6,
  loose:    1.75,
} as const;

export const letterSpacing = {
  tight:  -0.5,
  snug:   -0.3,
  normal:  0,
  wide:    0.2,
  wider:   0.5,
} as const;

/**
 * Semantic Typography Styles
 * Used directly in Text component variants
 */
export const textStyles = {
  // Display — hero numbers, large titles
  display2: {
    fontSize:      fontSize['8xl'],    // 36px
    fontWeight:    fontWeight.bold,
    lineHeight:    fontSize['8xl'] * lineHeight.tight,
    letterSpacing: letterSpacing.tight,
  },
  display1: {
    fontSize:      fontSize['7xl'],    // 32px
    fontWeight:    fontWeight.bold,
    lineHeight:    fontSize['7xl'] * lineHeight.tight,
    letterSpacing: letterSpacing.tight,
  },

  // Title — screen titles, section headers
  title1: {
    fontSize:      fontSize['6xl'],    // 28px
    fontWeight:    fontWeight.bold,
    lineHeight:    fontSize['6xl'] * lineHeight.snug,
    letterSpacing: letterSpacing.snug,
  },
  title2: {
    fontSize:      fontSize['5xl'],    // 24px
    fontWeight:    fontWeight.bold,
    lineHeight:    fontSize['5xl'] * lineHeight.snug,
    letterSpacing: letterSpacing.snug,
  },
  title3: {
    fontSize:      fontSize['4xl'],    // 22px
    fontWeight:    fontWeight.semiBold,
    lineHeight:    fontSize['4xl'] * lineHeight.snug,
    letterSpacing: letterSpacing.snug,
  },

  // Heading — card titles, list section headers
  heading1: {
    fontSize:      fontSize['3xl'],    // 20px
    fontWeight:    fontWeight.semiBold,
    lineHeight:    fontSize['3xl'] * lineHeight.snug,
    letterSpacing: letterSpacing.normal,
  },
  heading2: {
    fontSize:      fontSize['2xl'],    // 18px
    fontWeight:    fontWeight.semiBold,
    lineHeight:    fontSize['2xl'] * lineHeight.snug,
    letterSpacing: letterSpacing.normal,
  },
  heading3: {
    fontSize:      fontSize.xl,        // 17px
    fontWeight:    fontWeight.semiBold,
    lineHeight:    fontSize.xl * lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },

  // Body — main readable content
  body1: {
    fontSize:      fontSize.lg,        // 16px
    fontWeight:    fontWeight.regular,
    lineHeight:    fontSize.lg * lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },
  body1Medium: {
    fontSize:      fontSize.lg,        // 16px
    fontWeight:    fontWeight.medium,
    lineHeight:    fontSize.lg * lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },
  body2: {
    fontSize:      fontSize.base,      // 15px
    fontWeight:    fontWeight.regular,
    lineHeight:    fontSize.base * lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },
  body2Medium: {
    fontSize:      fontSize.base,      // 15px
    fontWeight:    fontWeight.medium,
    lineHeight:    fontSize.base * lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },

  // Label — buttons, chips, tags, tabs
  label1: {
    fontSize:      fontSize.md,        // 14px
    fontWeight:    fontWeight.medium,
    lineHeight:    fontSize.md * lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },
  label1Bold: {
    fontSize:      fontSize.md,        // 14px
    fontWeight:    fontWeight.semiBold,
    lineHeight:    fontSize.md * lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },
  label2: {
    fontSize:      fontSize.sm,        // 13px
    fontWeight:    fontWeight.medium,
    lineHeight:    fontSize.sm * lineHeight.normal,
    letterSpacing: letterSpacing.wide,
  },

  // Meta — consistent small label used across cards (가용자산, 투자중, 승률 등)
  // Matches the "대기중" status text style in AI agent section
  meta: {
    fontSize:      fontSize.md,        // 14px
    fontWeight:    fontWeight.semiBold,
    lineHeight:    fontSize.md * lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },

  // Caption — helper text, timestamps, metadata
  caption1: {
    fontSize:      fontSize.xs,        // 12px
    fontWeight:    fontWeight.regular,
    lineHeight:    fontSize.xs * lineHeight.relaxed,
    letterSpacing: letterSpacing.wide,
  },
  caption1Medium: {
    fontSize:      fontSize.xs,        // 12px
    fontWeight:    fontWeight.medium,
    lineHeight:    fontSize.xs * lineHeight.relaxed,
    letterSpacing: letterSpacing.wide,
  },
  caption2: {
    fontSize:      fontSize['2xs'],    // 11px
    fontWeight:    fontWeight.regular,
    lineHeight:    fontSize['2xs'] * lineHeight.relaxed,
    letterSpacing: letterSpacing.wide,
  },

  // Numeric — price, percentage display (tabular figures)
  numericLarge: {
    fontSize:      fontSize['7xl'],    // 32px
    fontWeight:    fontWeight.bold,
    lineHeight:    fontSize['7xl'] * lineHeight.tight,
    letterSpacing: letterSpacing.tight,
    fontVariant:   ['tabular-nums'] as const,
  },
  numericMedium: {
    fontSize:      fontSize['4xl'],    // 22px
    fontWeight:    fontWeight.semiBold,
    lineHeight:    fontSize['4xl'] * lineHeight.snug,
    letterSpacing: letterSpacing.normal,
    fontVariant:   ['tabular-nums'] as const,
  },
  numericSmall: {
    fontSize:      fontSize.lg,        // 16px
    fontWeight:    fontWeight.medium,
    lineHeight:    fontSize.lg * lineHeight.normal,
    letterSpacing: letterSpacing.normal,
    fontVariant:   ['tabular-nums'] as const,
  },
} as const;

export type TextStyleVariant = keyof typeof textStyles;
