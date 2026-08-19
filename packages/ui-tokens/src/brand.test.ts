import { describe, expect, it } from 'vitest';
import { brandColorKeys, brandColorPalette } from './index';

const HEX = /^#[0-9a-f]{6}$/i;

/** WCAG relative luminance / contrast ratio — same formula the app's own
 * accessibility fixes (see globals.css's --color-status-open comment) were
 * verified against by hand; asserted here so a future palette edit can't
 * silently regress below the 4.5:1 AA minimum for normal text. */
function contrastRatio(hexA: string, hexB: string): number {
  function luminance(hex: string): number {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  }
  const [l1, l2] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a);
  return (l1! + 0.05) / (l2! + 0.05);
}

describe('brandColorPalette', () => {
  it('includes green as the pre-existing default brand color', () => {
    expect(brandColorKeys).toContain('green');
    expect(brandColorPalette.green.light.base).toBe('#1f7a4d');
  });

  it('defines valid hex colors for every key in both color schemes', () => {
    for (const key of brandColorKeys) {
      for (const scheme of ['light', 'dark'] as const) {
        const shades = brandColorPalette[key][scheme];
        expect(shades.base).toMatch(HEX);
        expect(shades.subtle).toMatch(HEX);
        expect(shades.on).toMatch(HEX);
        expect(shades.contrast).toMatch(HEX);
      }
    }
  });

  it('meets WCAG AA (4.5:1) contrast for every text/background pairing this palette is used for', () => {
    for (const key of brandColorKeys) {
      for (const scheme of ['light', 'dark'] as const) {
        const { base, subtle, on, contrast } = brandColorPalette[key][scheme];
        expect(contrastRatio(on, subtle), `${key}/${scheme}: on vs subtle`).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(
          contrastRatio(contrast, base),
          `${key}/${scheme}: contrast vs base`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('gives every key a distinct base color per scheme — two colliding hues would defeat the point of choosing', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const bases = brandColorKeys.map((key) => brandColorPalette[key][scheme].base.toLowerCase());
      expect(new Set(bases).size).toBe(bases.length);
    }
  });
});
