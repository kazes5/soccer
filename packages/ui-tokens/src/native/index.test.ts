import { describe, expect, it } from 'vitest';
import { darkColors, lightColors, nativeElevation, nativeSpacing, statusToneColors } from './index';
import type { StatusTone } from '../status';

const tones: StatusTone[] = ['mine', 'covered', 'open', 'urgent', 'attention', 'pending'];

describe('nativeSpacing', () => {
  it('scales the base unit by the given multiplier, unitless', () => {
    expect(nativeSpacing(2)).toBe(8);
  });
});

describe('statusToneColors', () => {
  it('resolves every semantic tone in both color schemes with an icon, never color alone', () => {
    for (const scheme of ['light', 'dark'] as const) {
      for (const tone of tones) {
        const colors = statusToneColors(tone, scheme);
        expect(colors.icon).toBeTruthy();
        expect(colors.background).toMatch(/^#[0-9a-f]{6}$/i);
        expect(colors.onBackground).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('gives every tone a distinct icon, matching the web token set', () => {
    const icons = tones.map((tone) => statusToneColors(tone).icon);
    expect(new Set(icons).size).toBe(tones.length);
  });
});

describe('color schemes', () => {
  it('defines the same set of keys for light and dark', () => {
    expect(Object.keys(lightColors).sort()).toEqual(Object.keys(darkColors).sort());
  });
});

describe('nativeElevation', () => {
  it('defines matching iOS and Android shadow props for every elevation level', () => {
    for (const key of ['none', 'raised', 'overlay'] as const) {
      expect(nativeElevation[key].ios.shadowColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(nativeElevation[key].android.elevation).toBeGreaterThanOrEqual(0);
    }
  });
});
