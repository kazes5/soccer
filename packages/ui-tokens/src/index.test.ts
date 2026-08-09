import { describe, expect, it } from 'vitest';
import { spacing, statusTones, type StatusTone } from './index';

describe('spacing', () => {
  it('scales the base unit by the given multiplier', () => {
    expect(spacing(2)).toBe('8px');
  });
});

describe('statusTones', () => {
  const tones: StatusTone[] = ['mine', 'covered', 'open', 'urgent', 'attention', 'pending'];

  it('defines every semantic status tone', () => {
    for (const tone of tones) {
      expect(statusTones[tone]).toBeDefined();
    }
  });

  it('pairs every tone with an icon, never color alone', () => {
    for (const tone of tones) {
      expect(statusTones[tone].icon).toBeTruthy();
      expect(statusTones[tone].badgeClassName).toContain('text-');
    }
  });

  it('gives every tone a distinct icon — two tones sharing an icon defeats the color-blind-friendly pairing', () => {
    const icons = tones.map((tone) => statusTones[tone].icon);
    expect(new Set(icons).size).toBe(tones.length);
  });
});
