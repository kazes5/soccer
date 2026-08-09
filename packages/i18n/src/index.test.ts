import { describe, expect, it } from 'vitest';
import { directionFor, formatDate, formatNumber, isRtl, locales, translate } from './index';
import { en, he } from './messages';

describe('message catalog parity', () => {
  it('has an identical key set for every locale', () => {
    expect(Object.keys(he).sort()).toEqual(Object.keys(en).sort());
  });
});

describe('translate', () => {
  it('returns the message for the given locale', () => {
    expect(translate('en', 'common.logIn')).toBe('Log in');
    expect(translate('he', 'common.logIn')).toBe('התחברות');
  });

  it('interpolates named parameters', () => {
    expect(translate('en', 'home.welcome', { name: 'Dana Cohen' })).toBe('Welcome, Dana Cohen');
    expect(translate('he', 'invite.joinTitle', { teamName: 'U-12 Wildcats' })).toBe(
      'הצטרפות לU-12 Wildcats',
    );
  });

  it('leaves an unmatched placeholder untouched rather than throwing', () => {
    expect(translate('en', 'home.welcome', {})).toBe('Welcome, {name}');
  });
});

describe('direction and locale helpers', () => {
  it('marks Hebrew as RTL and English as LTR', () => {
    expect(isRtl('he')).toBe(true);
    expect(isRtl('en')).toBe(false);
    expect(directionFor('he')).toBe('rtl');
    expect(directionFor('en')).toBe('ltr');
  });

  it('exposes exactly the supported locales', () => {
    expect(locales).toEqual(['en', 'he']);
  });
});

describe('locale-aware formatting', () => {
  it('formats numbers using locale-appropriate digits and separators', () => {
    expect(formatNumber('en', 1234.5)).toBe('1,234.5');
    expect(formatNumber('he', 1234.5)).toMatch(/1,234\.5|1٬234\.5/);
  });

  it('formats dates differently per locale', () => {
    const date = new Date('2026-01-15T00:00:00Z');
    const enDate = formatDate('en', date, { timeZone: 'UTC' });
    const heDate = formatDate('he', date, { timeZone: 'UTC' });
    expect(enDate).not.toBe(heDate);
  });
});
