export interface TypeStyle {
  fontSizePx: number;
  lineHeightPx: number;
  fontWeight: 400 | 500 | 600 | 700;
  letterSpacingEm?: number;
}

/**
 * Heebo renders both Latin and Hebrew glyphs from one family, so the UI never has
 * to swap fonts when the locale switches (see CLAUDE.md §3.10).
 */
export const fontFamily = {
  sans: 'var(--font-heebo), "Segoe UI", system-ui, sans-serif',
  mono: 'var(--font-geist-mono), ui-monospace, "SFMono-Regular", monospace',
} as const;

export const typeScale = {
  caption: { fontSizePx: 12, lineHeightPx: 16, fontWeight: 500 },
  label: { fontSizePx: 13, lineHeightPx: 18, fontWeight: 600, letterSpacingEm: 0.02 },
  body: { fontSizePx: 15, lineHeightPx: 22, fontWeight: 400 },
  bodyStrong: { fontSizePx: 15, lineHeightPx: 22, fontWeight: 600 },
  title: { fontSizePx: 18, lineHeightPx: 24, fontWeight: 600 },
  headline: { fontSizePx: 22, lineHeightPx: 28, fontWeight: 700 },
} satisfies Record<string, TypeStyle>;

export type TypeScaleKey = keyof typeof typeScale;

/** Applied wherever dates, counts, or other digits must not visually jitter as they change. */
export const tabularNumberFontFeatureSettings = '"tnum" 1, "lnum" 1';
