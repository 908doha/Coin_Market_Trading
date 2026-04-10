/**
 * Color Tokens — Toss SEED-inspired, Black Primary Theme
 *
 * Scale tokens: raw palette values
 * Semantic tokens: contextual usage aliases
 */

// ─── Scale (Raw Palette) ────────────────────────────────────────────────────

export const palette = {
  black: '#000000',
  white: '#FFFFFF',

  gray: {
    950: '#0A0A0A',
    900: '#1A1A1A',
    850: '#242424',
    800: '#2E2E2E',
    750: '#383838',
    700: '#404040',
    650: '#4A4A4A',
    600: '#525252',
    500: '#737373',
    400: '#A3A3A3',
    300: '#C4C4C4',
    200: '#D9D9D9',
    150: '#E2E2E2',
    100: '#EBEBEB',
    75: '#F0F0F0',
    50: '#F5F5F5',
    25: '#FAFAFA',
  },

  green: {
    600: '#0D9E45',
    500: '#1AC24E',
    400: '#2DD962',
    300: '#6EE89A',
    100: '#D1F7E1',
    50:  '#EDFBF3',
  },

  red: {
    600: '#D93025',
    500: '#FF4747',
    400: '#FF6B6B',
    300: '#FF9595',
    100: '#FFD6D6',
    50:  '#FFF0F0',
  },

  orange: {
    600: '#D97706',
    500: '#FF8A00',
    400: '#FFAA33',
    100: '#FFE8B3',
    50:  '#FFF8E8',
  },

  blue: {
    600: '#1741C4',
    500: '#246CF9',
    400: '#5090FF',
    300: '#84B4FF',
    100: '#D1E4FF',
    50:  '#EEF5FF',
  },
} as const;

// ─── Semantic (Contextual Usage) ─────────────────────────────────────────────

export const colors = {
  // Primary brand
  primary: {
    default:    palette.black,
    subtle:     palette.gray[900],
    muted:      palette.gray[800],
    foreground: palette.white,
  },

  // Backgrounds
  bg: {
    default:   palette.white,
    subtle:    palette.gray[25],
    elevated:  palette.gray[50],
    overlay:   'rgba(0, 0, 0, 0.6)',
    inverse:   palette.black,
    sheet:     palette.white,
  },

  // Text
  text: {
    primary:   palette.black,
    secondary: palette.gray[700],
    tertiary:  palette.gray[500],
    disabled:  palette.gray[400],
    inverse:   palette.white,
    hint:      palette.gray[400],
    placeholder: palette.gray[300],
  },

  // Borders
  border: {
    default:  palette.gray[100],
    strong:   palette.gray[200],
    focus:    palette.black,
    disabled: palette.gray[100],
    inverse:  'rgba(255,255,255,0.2)',
  },

  // Semantic states
  positive: {
    default:    palette.green[500],
    subtle:     palette.green[50],
    foreground: palette.white,
    text:       palette.green[600],
  },

  negative: {
    default:    palette.red[500],
    subtle:     palette.red[50],
    foreground: palette.white,
    text:       palette.red[600],
  },

  cautious: {
    default:    palette.orange[500],
    subtle:     palette.orange[50],
    foreground: palette.white,
    text:       palette.orange[600],
  },

  informative: {
    default:    palette.blue[500],
    subtle:     palette.blue[50],
    foreground: palette.white,
    text:       palette.blue[600],
  },

  // Interactive states
  interactive: {
    hover:    'rgba(0, 0, 0, 0.04)',
    pressed:  'rgba(0, 0, 0, 0.08)',
    focused:  'rgba(0, 0, 0, 0.12)',
    disabled: palette.gray[50],
  },

  // Coin market specific
  market: {
    rise:    palette.red[500],    // Korean convention: red = up
    fall:    palette.blue[500],   // Korean convention: blue = down
    neutral: palette.gray[500],
    riseSubtle: palette.red[50],
    fallSubtle: palette.blue[50],
  },
} as const;

export type ColorToken = typeof colors;
