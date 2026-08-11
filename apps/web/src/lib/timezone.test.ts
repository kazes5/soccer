import { describe, expect, it } from 'vitest';
import { instantToWallClock } from './timezone';

describe('instantToWallClock', () => {
  it('converts a summer (DST) UTC instant to Asia/Jerusalem wall-clock time', () => {
    // 15:00 UTC in August is 18:00 in Asia/Jerusalem (UTC+3, daylight saving).
    expect(instantToWallClock(new Date('2026-08-11T15:00:00.000Z'), 'Asia/Jerusalem')).toEqual({
      date: '2026-08-11',
      time: '18:00',
    });
  });

  it('converts a winter (standard time) UTC instant to Asia/Jerusalem wall-clock time', () => {
    // 16:00 UTC in January is 18:00 in Asia/Jerusalem (UTC+2, standard time).
    expect(instantToWallClock(new Date('2026-01-15T16:00:00.000Z'), 'Asia/Jerusalem')).toEqual({
      date: '2026-01-15',
      time: '18:00',
    });
  });

  it('rolls the date over when the local time crosses midnight', () => {
    // 22:00 UTC in August is 01:00 the next day in Asia/Jerusalem.
    expect(instantToWallClock(new Date('2026-08-11T22:00:00.000Z'), 'Asia/Jerusalem')).toEqual({
      date: '2026-08-12',
      time: '01:00',
    });
  });

  it('never produces "24:00" for local midnight', () => {
    // 21:00 UTC in August is exactly midnight in Asia/Jerusalem.
    expect(instantToWallClock(new Date('2026-08-11T21:00:00.000Z'), 'Asia/Jerusalem').time).toBe(
      '00:00',
    );
  });
});
