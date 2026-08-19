/**
 * Splits a UTC instant into the calendar date ("YYYY-MM-DD") and wall-clock
 * time ("HH:MM") it represents in `timeZone`, using the browser's own `Intl`
 * timezone database. Display-only (UTC instant -> local wall-clock), so no
 * library is needed for this direction — the reverse (local wall-clock ->
 * instant) requires real DST-aware arithmetic and is deliberately kept
 * server-side (see `apps/api/src/lib/timezone.ts`); this client only ever
 * sends the raw local date/time strings and lets the API convert them.
 */
export function instantToWallClock(
  instant: Date,
  timeZone: string,
): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    // `hour12: false` alone is known to yield "24" instead of "00" at
    // midnight in some engines/locales; `hourCycle: 'h23'` is the reliable
    // way to force a plain 00-23 range.
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * True if `instant`'s calendar date in `timeZone` is strictly before today's
 * — mirrors the API's own `isPastCalendarDay` (see
 * `apps/api/src/lib/timezone.ts`), so the client only shows actions the
 * server will actually accept. A session stays actionable for its entire
 * calendar day even after its scheduled start time passes.
 */
export function isPastCalendarDay(
  instant: Date,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  return instantToWallClock(instant, timeZone).date < instantToWallClock(now, timeZone).date;
}
