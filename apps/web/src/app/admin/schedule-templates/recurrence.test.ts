import { describe, expect, it } from 'vitest';
import { buildRecurrenceRule, parseRecurrenceRule } from './recurrence';

describe('buildRecurrenceRule', () => {
  it('builds a weekly rule with no INTERVAL', () => {
    expect(buildRecurrenceRule({ frequency: 'weekly', days: ['MO', 'WE', 'FR'] })).toBe(
      'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    );
  });

  it('builds a biweekly rule with INTERVAL=2', () => {
    expect(buildRecurrenceRule({ frequency: 'biweekly', days: ['SA'] })).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA',
    );
  });
});

describe('parseRecurrenceRule', () => {
  it('round-trips a weekly rule built by buildRecurrenceRule', () => {
    const built = buildRecurrenceRule({ frequency: 'weekly', days: ['MO', 'WE', 'FR'] });
    expect(parseRecurrenceRule(built)).toEqual({ frequency: 'weekly', days: ['MO', 'WE', 'FR'] });
  });

  it('round-trips a biweekly rule built by buildRecurrenceRule', () => {
    const built = buildRecurrenceRule({ frequency: 'biweekly', days: ['SA'] });
    expect(parseRecurrenceRule(built)).toEqual({ frequency: 'biweekly', days: ['SA'] });
  });

  it('parses a rule with no explicit INTERVAL as weekly (matches existing seeded data)', () => {
    expect(parseRecurrenceRule('FREQ=WEEKLY;BYDAY=MO,WE,FR')).toEqual({
      frequency: 'weekly',
      days: ['MO', 'WE', 'FR'],
    });
  });

  it('returns null for a non-weekly frequency', () => {
    expect(parseRecurrenceRule('FREQ=DAILY')).toBeNull();
  });

  it('returns null for an unsupported interval', () => {
    expect(parseRecurrenceRule('FREQ=WEEKLY;INTERVAL=3;BYDAY=MO')).toBeNull();
  });

  it('returns null for a rule with extra fields the picker cannot represent', () => {
    expect(parseRecurrenceRule('FREQ=WEEKLY;BYDAY=MO;COUNT=10')).toBeNull();
  });

  it('returns null for a missing BYDAY', () => {
    expect(parseRecurrenceRule('FREQ=WEEKLY')).toBeNull();
  });

  it('returns null for an invalid weekday code', () => {
    expect(parseRecurrenceRule('FREQ=WEEKLY;BYDAY=MO,ZZ')).toBeNull();
  });

  it('tolerates a trailing semicolon, e.g. from a hand-edited or imported rule', () => {
    expect(parseRecurrenceRule('FREQ=WEEKLY;BYDAY=MO,WE,FR;')).toEqual({
      frequency: 'weekly',
      days: ['MO', 'WE', 'FR'],
    });
  });
});
