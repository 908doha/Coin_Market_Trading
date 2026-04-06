/**
 * Spacing Tokens — 4px base grid
 *
 * Used for: margin, padding, gap, insets
 * Naming: number = value in px
 */

export const spacing = {
  0:   0,
  0.5: 2,
  1:   4,
  1.5: 6,
  2:   8,
  2.5: 10,
  3:   12,
  3.5: 14,
  4:   16,
  5:   20,
  6:   24,
  7:   28,
  8:   32,
  9:   36,
  10:  40,
  11:  44,
  12:  48,
  14:  56,
  16:  64,
  18:  72,
  20:  80,
  24:  96,
  28:  112,
  32:  128,
} as const;

/**
 * Semantic Spacing Aliases
 * Maps to contextual usage within components
 */
export const semanticSpacing = {
  // Screen/section padding
  screenHorizontal: spacing[5],   // 20px
  screenVertical:   spacing[6],   // 24px
  sectionGap:       spacing[8],   // 32px

  // Card inner padding
  cardPaddingHorizontal: spacing[5],  // 20px
  cardPaddingVertical:   spacing[4],  // 16px

  // List item
  listItemPaddingHorizontal: spacing[5],  // 20px
  listItemPaddingVertical:   spacing[4],  // 16px
  listItemGap:               spacing[3],  // 12px

  // Component gaps
  componentGapXs: spacing[1],    // 4px
  componentGapSm: spacing[2],    // 8px
  componentGapMd: spacing[3],    // 12px
  componentGapLg: spacing[4],    // 16px
  componentGapXl: spacing[5],    // 20px

  // Button
  buttonPaddingHorizontalSm: spacing[3],   // 12px
  buttonPaddingHorizontalMd: spacing[4],   // 16px
  buttonPaddingHorizontalLg: spacing[5],   // 20px
  buttonPaddingVerticalSm:   spacing[2],   // 8px
  buttonPaddingVerticalMd:   spacing[3],   // 12px
  buttonPaddingVerticalLg:   spacing[4],   // 16px

  // Input
  inputPaddingHorizontal: spacing[4],   // 16px
  inputPaddingVertical:   spacing[3],   // 12px

  // Navigation
  tabBarHeight:    spacing[14] + spacing[2],  // 60px
  navBarHeight:    spacing[11],               // 44px
  bottomSafeArea:  spacing[8],               // 32px
} as const;

export type SpacingToken = typeof spacing;
