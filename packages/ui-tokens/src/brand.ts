/**
 * Per-team accent color (CLAUDE.md §12 roadmap, "Team Color Theming"). A
 * curated palette, not free-text/arbitrary hex — every entry below is a
 * named, WCAG-AA-contrast-checked color pair (light + dark mode), matching
 * `status.ts`'s existing per-tone light/dark structure. `green` is the
 * app's pre-existing default brand color (identical to the values
 * `--color-status-mine` already used before this feature), so a team with
 * no explicit choice renders pixel-identical to before.
 *
 * `red`, `orange`, and `yellow` were added 2026-08-20 at explicit product
 * request, despite sitting in the same hue family as the fixed shift-status
 * tones in `status.ts` (red/coral = "open"/urgent, amber = "attention").
 * They're deliberately shifted away from those exact status hues (a darker
 * crimson/burnt-orange/gold rather than status.ts's coral/amber) so a badge
 * and a brand button next to each other read as visually distinct, but a
 * team that picks one of these three should expect *some* residual
 * resemblance to the always-on status colors — that trade-off was accepted
 * knowingly, not overlooked. Applies only to non-semantic "brand" UI
 * (primary buttons, the active bottom-nav tab, links, a success toast) —
 * never to the shift-status tones in `status.ts`, which stay fixed
 * regardless of a team's chosen color.
 */
export type BrandColorKey =
  'green' | 'blue' | 'indigo' | 'purple' | 'fuchsia' | 'slate' | 'red' | 'orange' | 'yellow';

export interface BrandColorShades {
  /** Solid background for primary buttons, active-tab indicators. */
  base: string;
  /** Light tint background for subtle badges/highlights. */
  subtle: string;
  /** Readable text color on `subtle` (or a plain surface) backgrounds. */
  on: string;
  /** Readable text color on a solid `base` background. */
  contrast: string;
}

export interface BrandColorEntry {
  light: BrandColorShades;
  dark: BrandColorShades;
}

/**
 * Every pair below was verified against WCAG AA's 4.5:1 minimum contrast
 * ratio for normal text (`on` vs `subtle`, `on` vs the plain surface color,
 * and `contrast` vs `base`) before being added here — the same bar this
 * project's own accessibility gate already enforces (see globals.css's
 * comment on `--color-status-open` for the one real contrast bug that gate
 * previously caught).
 */
export const brandColorPalette: Record<BrandColorKey, BrandColorEntry> = {
  green: {
    light: { base: '#1f7a4d', subtle: '#e6f3ec', on: '#146239', contrast: '#ffffff' },
    dark: { base: '#3fb586', subtle: '#113523', on: '#7bd6ac', contrast: '#062013' },
  },
  blue: {
    light: { base: '#1d4ed8', subtle: '#dbeafe', on: '#1e3a8a', contrast: '#ffffff' },
    dark: { base: '#60a5fa', subtle: '#1e3a5f', on: '#93c5fd', contrast: '#0a1628' },
  },
  indigo: {
    light: { base: '#4338ca', subtle: '#e0e7ff', on: '#3730a3', contrast: '#ffffff' },
    dark: { base: '#818cf8', subtle: '#2e2a5f', on: '#a5b4fc', contrast: '#14123a' },
  },
  purple: {
    light: { base: '#7e22ce', subtle: '#f3e8ff', on: '#6b21a8', contrast: '#ffffff' },
    dark: { base: '#c084fc', subtle: '#3b1f5c', on: '#d8b4fe', contrast: '#1f0f33' },
  },
  fuchsia: {
    light: { base: '#a21caf', subtle: '#fae8ff', on: '#86198f', contrast: '#ffffff' },
    dark: { base: '#e879f9', subtle: '#4a1a52', on: '#f0abfc', contrast: '#2b0d30' },
  },
  slate: {
    light: { base: '#334155', subtle: '#f1f5f9', on: '#1e293b', contrast: '#ffffff' },
    dark: { base: '#94a3b8', subtle: '#1e293b', on: '#cbd5e1', contrast: '#0f172a' },
  },
  red: {
    light: { base: '#b91c1c', subtle: '#fee2e2', on: '#991b1b', contrast: '#ffffff' },
    dark: { base: '#f87171', subtle: '#3f1414', on: '#fca5a5', contrast: '#1a0505' },
  },
  orange: {
    // `base` set to the user's requested #FF7e00 (2026-08-20) — a much more
    // vivid/saturated orange than this palette's other entries, which all
    // lean dark/muted specifically so white `contrast` text stays readable
    // on them. This one doesn't: white-on-#FF7e00 is only ~2.6:1, well
    // under WCAG AA's 4.5:1 floor, so `contrast` switches to the same
    // near-black already used for this same hue family's dark-mode
    // `contrast` below (`#1f0f02`) instead — verified by brand.test.ts.
    light: { base: '#ff7e00', subtle: '#ffedd5', on: '#9a3412', contrast: '#1f0f02' },
    dark: { base: '#fb923c', subtle: '#3a1f0a', on: '#fdba74', contrast: '#1f0f02' },
  },
  yellow: {
    // `base` set to the user's requested #FFEF00 (2026-08-20 SOC-58 fix) — a
    // pure, saturated yellow. Same white-text problem as `orange` above:
    // white-on-#FFEF00 fails WCAG AA badly, so `contrast` switches to black
    // (~17.6:1) instead of the palette's usual white — verified by
    // brand.test.ts. `subtle`/`on` are unaffected by the `base` swap.
    light: { base: '#ffef00', subtle: '#fef9c3', on: '#713f12', contrast: '#000000' },
    dark: { base: '#facc15', subtle: '#3f3502', on: '#fde047', contrast: '#221c00' },
  },
};

export const brandColorKeys = Object.keys(brandColorPalette) as BrandColorKey[];
