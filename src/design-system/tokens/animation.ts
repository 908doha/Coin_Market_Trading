/**
 * Animation & Motion Tokens — Toss-style fluid motion
 */

export const duration = {
  instant:   0,
  fast:      100,
  normal:    200,
  moderate:  300,
  slow:      400,
  sluggish:  600,
} as const;

export const easing = {
  // Standard
  linear:      'linear',
  ease:        'ease',
  easeIn:      'ease-in',
  easeOut:     'ease-out',
  easeInOut:   'ease-in-out',

  // Toss-style spring-like curves
  spring:      'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  decelerate:  'cubic-bezier(0.0, 0.0, 0.2, 1)',    // enter
  accelerate:  'cubic-bezier(0.4, 0.0, 1, 1)',       // exit
  standard:    'cubic-bezier(0.4, 0.0, 0.2, 1)',     // move
} as const;

/**
 * Reanimated-compatible spring configs
 */
export const springConfig = {
  gentle: {
    damping: 20,
    stiffness: 200,
    mass: 1,
  },
  bouncy: {
    damping: 10,
    stiffness: 300,
    mass: 1,
  },
  snappy: {
    damping: 30,
    stiffness: 400,
    mass: 0.8,
  },
  slow: {
    damping: 40,
    stiffness: 100,
    mass: 1.2,
  },
} as const;

export type DurationToken = keyof typeof duration;
export type EasingToken = keyof typeof easing;
