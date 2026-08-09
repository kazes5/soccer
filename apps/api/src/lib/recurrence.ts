// `rrule` ships as CommonJS with no `exports` map, so Node's ESM loader can't
// statically detect its named exports at runtime (this only surfaces when actually
// running under `tsx`/Node — `tsc`/Vite-based Vitest both resolve it fine from the
// type declarations, which is what let this slip past typecheck and unit tests).
import RRulePackage, { type Options } from 'rrule';
const { RRule } = RRulePackage;

/**
 * Validates and parses an RFC 5545 RRULE string (e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR"),
 * without a DTSTART component — the caller supplies `dtstart` separately since it
 * comes from the schedule template's own `startDate`/`defaultTime` fields.
 */
export function parseRecurrenceRule(recurrenceRule: string): Partial<Options> {
  try {
    return RRule.parseString(recurrenceRule);
  } catch {
    throw new Error(`Invalid recurrence rule: ${recurrenceRule}`);
  }
}

/**
 * Combines a calendar date with an "HH:MM" time-of-day into one instant.
 *
 * Both are read/written using UTC getters throughout this module, deliberately
 * treating the result as literal wall-clock numbers rather than a true
 * IANA-timezone-aware instant — see the Stage 3 note in PLAN.md. Real
 * timezone/DST-safe conversion (needed for reminders/escalation) is Stage 4's job.
 */
export function combineDateAndTime(date: Date, time: string): Date {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) {
    throw new Error(`Invalid time: ${time}`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new Error(`Invalid time: ${time}`);
  }
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, minutes),
  );
}

/**
 * Generates practice-session start instants for a recurrence rule, over a horizon
 * measured in whole weeks starting at `dtstart` (inclusive).
 */
export function generateOccurrences(
  recurrenceRule: string,
  dtstart: Date,
  horizonWeeks: number,
): Date[] {
  const rule = new RRule({ ...parseRecurrenceRule(recurrenceRule), dtstart });
  const horizonEnd = new Date(dtstart.getTime() + horizonWeeks * 7 * 24 * 60 * 60 * 1000);
  return rule.between(dtstart, horizonEnd, true);
}
