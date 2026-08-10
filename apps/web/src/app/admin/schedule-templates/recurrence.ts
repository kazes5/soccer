export const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

export interface RecurrenceBuilderState {
  frequency: 'weekly' | 'biweekly';
  days: WeekdayCode[];
}

/** Canonical order (FREQ, then INTERVAL when present, then BYDAY) so every rule this
 * wizard writes round-trips cleanly through parseRecurrenceRule on a later edit. */
export function buildRecurrenceRule(state: RecurrenceBuilderState): string {
  const parts = ['FREQ=WEEKLY'];
  if (state.frequency === 'biweekly') parts.push('INTERVAL=2');
  parts.push(`BYDAY=${state.days.join(',')}`);
  return parts.join(';');
}

/** Returns null for any rule outside the simple weekly/biweekly + weekday-list shape
 * this wizard builds (e.g. a hand-written custom rule) — the caller falls back to a
 * read-only display rather than losing/misrepresenting that rule. */
export function parseRecurrenceRule(rule: string): RecurrenceBuilderState | null {
  const fields = new Map(
    rule.split(';').map((part) => {
      const [key = '', value] = part.split('=');
      return [key, value] as const;
    }),
  );
  if (fields.get('FREQ') !== 'WEEKLY') return null;

  const byDay = fields.get('BYDAY');
  if (!byDay) return null;
  const days = byDay.split(',');
  if (days.length === 0 || !days.every((day): day is WeekdayCode => isWeekdayCode(day))) {
    return null;
  }

  const intervalRaw = fields.get('INTERVAL');
  const interval = intervalRaw === undefined ? 1 : Number(intervalRaw);
  if (interval !== 1 && interval !== 2) return null;

  // Only FREQ/INTERVAL/BYDAY are expected — any other field (COUNT, UNTIL, BYMONTH,
  // ...) means this isn't a rule the simple picker can faithfully represent.
  const knownKeys = new Set(['FREQ', 'INTERVAL', 'BYDAY']);
  if ([...fields.keys()].some((key) => !knownKeys.has(key))) return null;

  return { frequency: interval === 2 ? 'biweekly' : 'weekly', days };
}

function isWeekdayCode(value: string): value is WeekdayCode {
  return (WEEKDAY_CODES as readonly string[]).includes(value);
}
