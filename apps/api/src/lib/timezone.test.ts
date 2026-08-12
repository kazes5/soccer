import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import {
  instantToWallClock,
  isValidTimeZone,
  isWithinQuietHours,
  localDateTimeToInstant,
  wallClockToInstant,
} from './timezone';

describe('isValidTimeZone', () => {
  it('accepts a real IANA identifier', () => {
    expect(isValidTimeZone('Asia/Jerusalem')).toBe(true);
  });

  it('rejects a non-existent identifier', () => {
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });
});

describe('wallClockToInstant', () => {
  it('converts a summer (DST) wall-clock time using the UTC+3 offset', () => {
    // 2026-08-11 is deep in Israeli DST (summer).
    const instant = wallClockToInstant(new Date(Date.UTC(2026, 7, 11, 18, 0)), 'Asia/Jerusalem');
    expect(instant.toISOString()).toBe('2026-08-11T15:00:00.000Z');
  });

  it('converts a winter (standard time) wall-clock time using the UTC+2 offset', () => {
    // 2026-01-15 is deep in Israeli standard time (winter).
    const instant = wallClockToInstant(new Date(Date.UTC(2026, 0, 15, 18, 0)), 'Asia/Jerusalem');
    expect(instant.toISOString()).toBe('2026-01-15T16:00:00.000Z');
  });

  it('throws for an invalid timezone', () => {
    expect(() => wallClockToInstant(new Date(Date.UTC(2026, 7, 11, 18, 0)), 'Not/AZone')).toThrow(
      'Invalid wall-clock time',
    );
  });
});

describe('instantToWallClock', () => {
  it('is the exact inverse of wallClockToInstant', () => {
    const wallClock = new Date(Date.UTC(2026, 7, 11, 18, 0));
    const instant = wallClockToInstant(wallClock, 'Asia/Jerusalem');
    expect(instantToWallClock(instant, 'Asia/Jerusalem')).toEqual({
      date: '2026-08-11',
      time: '18:00',
    });
  });
});

describe('localDateTimeToInstant', () => {
  it('matches wallClockToInstant for the same date/time/zone', () => {
    expect(localDateTimeToInstant('2026-08-11', '18:00', 'Asia/Jerusalem').toISOString()).toBe(
      '2026-08-11T15:00:00.000Z',
    );
  });

  it('throws for a malformed date/time', () => {
    expect(() => localDateTimeToInstant('not-a-date', '18:00', 'Asia/Jerusalem')).toThrow(
      'Invalid date/time',
    );
  });
});

describe('DST boundary (Asia/Jerusalem)', () => {
  it('keeps the same displayed wall-clock time across the spring-forward transition, one hour apart in UTC', () => {
    // Finds the actual 2026 transition via Luxon's own IANA data instead of a
    // hardcoded date, so this test stays correct even if Israel's DST rule
    // (which has changed historically) changes again. Checks the offset at
    // 18:00 specifically (not midnight) since the transition itself happens
    // at 02:00 local — scanning at midnight would find the day *after* the
    // one where 18:00 first shifts.
    let day = DateTime.fromObject(
      { year: 2026, month: 1, day: 1, hour: 18 },
      { zone: 'Asia/Jerusalem' },
    );
    const standardOffset = day.offset;
    while (day.year === 2026 && day.offset === standardOffset) {
      day = day.plus({ days: 1 });
    }
    const dstStart = day;
    const dayBefore = dstStart.minus({ days: 1 });

    const beforeInstant = wallClockToInstant(
      new Date(Date.UTC(dayBefore.year, dayBefore.month - 1, dayBefore.day, 18, 0)),
      'Asia/Jerusalem',
    );
    const afterInstant = wallClockToInstant(
      new Date(Date.UTC(dstStart.year, dstStart.month - 1, dstStart.day, 18, 0)),
      'Asia/Jerusalem',
    );

    // Both are "18:00 local" on their own day...
    expect(instantToWallClock(beforeInstant, 'Asia/Jerusalem').time).toBe('18:00');
    expect(instantToWallClock(afterInstant, 'Asia/Jerusalem').time).toBe('18:00');
    // ...but the clocks moved forward an hour between them, so the true UTC
    // instants are only 23 hours apart, not 24 — proof the conversion is
    // recomputing the offset per-occurrence rather than applying one fixed
    // offset across the whole recurring series.
    const hoursApart = (afterInstant.getTime() - beforeInstant.getTime()) / (60 * 60 * 1000);
    expect(hoursApart).toBe(23);
  });

  it('keeps the same displayed wall-clock time across the fall-back transition, one hour apart in UTC', () => {
    let day = DateTime.fromObject(
      { year: 2026, month: 7, day: 1, hour: 18 },
      { zone: 'Asia/Jerusalem' },
    );
    const dstOffset = day.offset;
    while (day.year === 2026 && day.offset === dstOffset) {
      day = day.plus({ days: 1 });
    }
    const standardStart = day;
    const dayBefore = standardStart.minus({ days: 1 });

    const beforeInstant = wallClockToInstant(
      new Date(Date.UTC(dayBefore.year, dayBefore.month - 1, dayBefore.day, 18, 0)),
      'Asia/Jerusalem',
    );
    const afterInstant = wallClockToInstant(
      new Date(Date.UTC(standardStart.year, standardStart.month - 1, standardStart.day, 18, 0)),
      'Asia/Jerusalem',
    );

    expect(instantToWallClock(beforeInstant, 'Asia/Jerusalem').time).toBe('18:00');
    expect(instantToWallClock(afterInstant, 'Asia/Jerusalem').time).toBe('18:00');
    const hoursApart = (afterInstant.getTime() - beforeInstant.getTime()) / (60 * 60 * 1000);
    expect(hoursApart).toBe(25);
  });
});

describe('isWithinQuietHours', () => {
  // 2026-08-11 is deep in Israeli DST (summer, UTC+3) throughout these tests.
  function instantAt(hour: number, minute = 0): Date {
    return wallClockToInstant(new Date(Date.UTC(2026, 7, 11, hour, minute)), 'Asia/Jerusalem');
  }

  it('is true in the middle of a midnight-spanning window (the documented default)', () => {
    expect(isWithinQuietHours(instantAt(23, 30), 'Asia/Jerusalem', '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours(instantAt(3, 0), 'Asia/Jerusalem', '22:00', '07:00')).toBe(true);
  });

  it('is false in the middle of the day, outside a midnight-spanning window', () => {
    expect(isWithinQuietHours(instantAt(14, 0), 'Asia/Jerusalem', '22:00', '07:00')).toBe(false);
  });

  it('treats the start boundary as inclusive and the end boundary as exclusive', () => {
    expect(isWithinQuietHours(instantAt(22, 0), 'Asia/Jerusalem', '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours(instantAt(7, 0), 'Asia/Jerusalem', '22:00', '07:00')).toBe(false);
  });

  it('handles a same-day (non-midnight-spanning) window correctly', () => {
    expect(isWithinQuietHours(instantAt(12, 0), 'Asia/Jerusalem', '09:00', '17:00')).toBe(true);
    expect(isWithinQuietHours(instantAt(20, 0), 'Asia/Jerusalem', '09:00', '17:00')).toBe(false);
  });

  it('treats an equal start and end as never quiet, not always quiet', () => {
    expect(isWithinQuietHours(instantAt(3, 0), 'Asia/Jerusalem', '22:00', '22:00')).toBe(false);
  });
});
