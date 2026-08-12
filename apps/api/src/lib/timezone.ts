import { DateTime } from 'luxon';

/** True if `timeZone` is a real IANA timezone identifier Luxon/`Intl` recognizes. */
export function isValidTimeZone(timeZone: string): boolean {
  return DateTime.local().setZone(timeZone).isValid;
}

/**
 * Converts a "pseudo-UTC" wall-clock `Date` — one whose UTC-labeled getters
 * (`getUTCFullYear()` etc.) represent literal calendar wall-clock components,
 * not a real instant, exactly what `combineDateAndTime`/`generateOccurrences`
 * in `recurrence.ts` produce — into the true UTC instant that wall-clock time
 * represents in `timeZone`, correctly respecting whichever DST rule applies on
 * that specific date rather than one fixed offset for the whole year (e.g.
 * 18:00 in `Asia/Jerusalem` is UTC+3 in August, UTC+2 in January).
 */
export function wallClockToInstant(wallClock: Date, timeZone: string): Date {
  const dt = DateTime.fromObject(
    {
      year: wallClock.getUTCFullYear(),
      month: wallClock.getUTCMonth() + 1,
      day: wallClock.getUTCDate(),
      hour: wallClock.getUTCHours(),
      minute: wallClock.getUTCMinutes(),
    },
    { zone: timeZone },
  );
  if (!dt.isValid) {
    throw new Error(`Invalid wall-clock time for zone ${timeZone}: ${dt.invalidReason}`);
  }
  return dt.toJSDate();
}

/**
 * The inverse of {@link wallClockToInstant}: splits a true UTC instant into the
 * calendar date ("YYYY-MM-DD") and wall-clock time ("HH:MM") it represents in
 * `timeZone` — for display, and for pre-filling an edit form with the value a
 * team-local viewer should see.
 */
export function instantToWallClock(
  instant: Date,
  timeZone: string,
): { date: string; time: string } {
  const dt = DateTime.fromJSDate(instant, { zone: 'utc' }).setZone(timeZone);
  return { date: dt.toFormat('yyyy-MM-dd'), time: dt.toFormat('HH:mm') };
}

/**
 * Converts a "YYYY-MM-DD" date and "HH:MM" time directly to the true UTC
 * instant they represent in `timeZone` — for endpoints that accept local
 * date/time strings directly (e.g. a session edit) rather than a pseudo-UTC
 * `Date` built via `combineDateAndTime`.
 */
export function localDateTimeToInstant(date: string, time: string, timeZone: string): Date {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: timeZone });
  if (!dt.isValid) {
    throw new Error(`Invalid date/time for zone ${timeZone}: ${dt.invalidReason}`);
  }
  return dt.toJSDate();
}

function minutesSinceMidnight(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * True if `instant`, expressed in `timeZone`'s wall-clock time, falls inside
 * the `[start, end)` quiet-hours window — used to gate browser push per ADR
 * 0001 ("except emergency events, which bypass... quiet hours"). Handles a
 * window that spans midnight (the documented default, 22:00-07:00) the same
 * way as one that doesn't: `start === end` is treated as never-quiet (a
 * zero-length window can't usefully mean "always quiet").
 */
export function isWithinQuietHours(
  instant: Date,
  timeZone: string,
  start: string,
  end: string,
): boolean {
  const nowMinutes = minutesSinceMidnight(instantToWallClock(instant, timeZone).time);
  const startMinutes = minutesSinceMidnight(start);
  const endMinutes = minutesSinceMidnight(end);

  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}
