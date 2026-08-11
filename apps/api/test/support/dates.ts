/** Nearest Monday at least `weeksAhead` weeks from real "now" — used so tests
 * that rely on a future/past split never become flaky just because the suite
 * happens to run on or near a fixed calendar date. */
export function futureMondayDateString(weeksAhead: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + weeksAhead * 7);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + ((8 - day) % 7));
  return d.toISOString().slice(0, 10);
}

/** Nearest Monday at least `weeksAgo` weeks before real "now". */
export function pastMondayDateString(weeksAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - weeksAgo * 7);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return d.toISOString().slice(0, 10);
}
