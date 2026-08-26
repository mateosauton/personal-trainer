/**
 * Design tokens. Dark-only, Ladder-inspired: near-black ground, high-contrast
 * display type, one loud accent used sparingly so it always means "act".
 */

export const colors = {
  bg: '#0A0A0B',
  surface: '#141416',
  elevated: '#1C1C1F',
  overlay: 'rgba(10,10,11,0.88)',

  text: '#FFFFFF',
  muted: '#8E8E93',
  faint: '#5A5A61',

  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',

  accent: '#D7FF3E',
  accentInk: '#12160A',
  success: '#34C759',
  danger: '#FF453A',
  warn: '#FFB340',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/**
 * Display sizes carry negative tracking; the small uppercase `overline` is the
 * workhorse label ("BLOCK 2 OF 4", "SET 3 OF 4") and is the one style that
 * tracks positive.
 */
export const type = {
  display: { fontSize: 40, fontWeight: '800', letterSpacing: -1.2, lineHeight: 44 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.8, lineHeight: 32 },
  heading: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4, lineHeight: 25 },
  body: { fontSize: 16, fontWeight: '500', letterSpacing: -0.1, lineHeight: 22 },
  small: { fontSize: 14, fontWeight: '500', lineHeight: 19 },
  overline: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, lineHeight: 14 },
  numeral: { fontSize: 44, fontWeight: '800', letterSpacing: -1.5, lineHeight: 48 },
} as const;

export const duration = {
  fast: 140,
  base: 240,
  slow: 420,
  /** One full start→end→start pass of the 2-still crossfade. */
  crossfade: 1200,
} as const;
