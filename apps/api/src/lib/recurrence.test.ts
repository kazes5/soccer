import { describe, expect, it } from 'vitest';
import { combineDateAndTime, generateOccurrences, parseRecurrenceRule } from './recurrence';

describe('parseRecurrenceRule', () => {
  it('parses a valid weekly-by-day rule', () => {
    const parsed = parseRecurrenceRule('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(parsed.freq).toBeDefined();
  });

  it('throws on garbage input', () => {
    expect(() => parseRecurrenceRule('not a rule')).toThrow('Invalid recurrence rule');
  });
});

describe('combineDateAndTime', () => {
  it('combines a date with an HH:MM time into one UTC instant', () => {
    const combined = combineDateAndTime(new Date('2026-08-10T00:00:00.000Z'), '18:30');
    expect(combined.toISOString()).toBe('2026-08-10T18:30:00.000Z');
  });

  it('rejects a malformed time', () => {
    expect(() => combineDateAndTime(new Date('2026-08-10T00:00:00.000Z'), '6:30pm')).toThrow(
      'Invalid time',
    );
  });

  it('rejects an out-of-range time', () => {
    expect(() => combineDateAndTime(new Date('2026-08-10T00:00:00.000Z'), '24:00')).toThrow(
      'Invalid time',
    );
  });
});

describe('generateOccurrences', () => {
  it('generates one occurrence per matching weekday within the horizon', () => {
    // 2026-08-10 is a Monday.
    const dtstart = combineDateAndTime(new Date('2026-08-10T00:00:00.000Z'), '18:00');
    const occurrences = generateOccurrences('FREQ=WEEKLY;BYDAY=MO,WE,FR', dtstart, 2);

    // 2-week horizon inclusive of both boundary Mondays: Mon/Wed/Fri x2 weeks,
    // plus the horizon-end Monday itself (`between` is inclusive) = 7.
    expect(occurrences).toHaveLength(7);
    expect(occurrences[0]?.toISOString()).toBe('2026-08-10T18:00:00.000Z');
    // Next occurrence is Wednesday the 12th, same time.
    expect(occurrences[1]?.toISOString()).toBe('2026-08-12T18:00:00.000Z');
  });

  it('excludes occurrences past the horizon end', () => {
    const dtstart = combineDateAndTime(new Date('2026-08-10T00:00:00.000Z'), '18:00');
    const occurrences = generateOccurrences('FREQ=WEEKLY;BYDAY=MO', dtstart, 1);

    for (const occurrence of occurrences) {
      expect(occurrence.getTime()).toBeLessThanOrEqual(dtstart.getTime() + 7 * 24 * 60 * 60 * 1000);
    }
  });
});
