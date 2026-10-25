import type {
  ScheduleImportOperation,
  ScheduleImportSessionFields,
  SessionKind,
} from '@soccer/contracts';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { instantToWallClock } from './timezone';

/**
 * The coach-message import's two halves that don't touch the database or the
 * network: the extraction prompt the model gets, and the deterministic
 * planner that turns the model's extraction into concrete create / update /
 * cancel operations against the team's real sessions.
 *
 * The split is deliberate: the model only reads the message (dates, times,
 * places, game vs. practice) — it never sees session ids and never decides
 * which existing session a line refers to. Matching is plain code below, so
 * the same extraction always produces the same proposal and a confused model
 * can't target an arbitrary session.
 */

const HEBREW_WEEKDAYS = ['שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת', 'ראשון'];

/** How far ahead an extracted date may land before it's treated as a model
 *  mistake rather than a real plan — coach messages cover days to weeks. */
const MAX_DAYS_AHEAD = 120;

/** The longest period a "this is the full schedule" message may cover — the
 *  Sunday–Saturday week coach messages are written for. */
const MAX_FULL_SCHEDULE_DAYS = 7;

const nullableText = z
  .string()
  .nullish()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  });

const extractedDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const extractedTime = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/);

/** Lenient on purpose — models drift on optional keys. A malformed event is
 *  dropped individually (see `parseExtraction`) rather than failing the whole
 *  message. */
const extractedEventSchema = z.object({
  date: extractedDate,
  time: extractedTime,
  kind: z.enum(['practice', 'game']).catch('practice'),
  title: nullableText,
  location: nullableText,
  notes: nullableText,
});

const extractedCancellationSchema = z.object({
  date: extractedDate,
  kind: z.enum(['practice', 'game']).nullish().catch(null),
});

export interface ScheduleExtraction {
  events: Array<z.infer<typeof extractedEventSchema>>;
  cancellations: Array<z.infer<typeof extractedCancellationSchema>>;
  fullSchedule: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  unresolved: string[];
}

function parseEach<T>(schema: z.ZodType<T>, value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const result = schema.safeParse(item);
    return result.success ? [result.data] : [];
  });
}

/** Turns the model's raw JSON into a well-typed extraction, discarding
 *  anything malformed instead of throwing. */
export function parseExtraction(raw: unknown): ScheduleExtraction {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const period = (key: string) => {
    const result = extractedDate.safeParse(record[key]);
    return result.success ? result.data : null;
  };
  return {
    events: parseEach(extractedEventSchema, record.events),
    cancellations: parseEach(extractedCancellationSchema, record.cancellations),
    fullSchedule: record.fullSchedule === true,
    periodStart: period('periodStart'),
    periodEnd: period('periodEnd'),
    unresolved: parseEach(z.string().trim().min(1).max(300), record.unresolved).slice(0, 10),
  };
}

export function buildExtractionPrompt(referenceDate: string): string {
  const reference = DateTime.fromISO(referenceDate, { zone: 'utc' });
  // A ready-made calendar — models resolve "next Tuesday" against a printed
  // table far more reliably than by doing weekday arithmetic themselves.
  const calendar = Array.from({ length: 21 }, (_, offset) => {
    const day = reference.plus({ days: offset });
    const marker = offset === 0 ? ' <- reference date (the day the message was sent)' : '';
    return `${day.toFormat('yyyy-MM-dd')} ${day.toFormat('cccc')} (${HEBREW_WEEKDAYS[day.weekday - 1]})${marker}`;
  }).join('\n');

  return [
    "You extract a youth soccer team's practice and game schedule from a message the coach sent to parents.",
    'The message is usually Hebrew, WhatsApp style (*bold* markers, emojis, informal phrasing).',
    'Reply with ONLY one JSON object, no prose, in exactly this shape:',
    '{"events":[{"date":"YYYY-MM-DD","time":"HH:MM","kind":"practice"|"game","title":string|null,"location":string|null,"notes":string|null}],',
    ' "cancellations":[{"date":"YYYY-MM-DD","kind":"practice"|"game"|null}],',
    ' "fullSchedule":boolean,"periodStart":"YYYY-MM-DD"|null,"periodEnd":"YYYY-MM-DD"|null,"unresolved":[string]}',
    '',
    'Rules:',
    '- Resolve every date against the calendar below. Weeks run Sunday to Saturday.',
    '- "next week" ("שבוע הבא", "השבוע הבא", "לשבוע הבא") is the Sunday-Saturday week after the week containing the reference date.',
    '- A weekday named in a message about next week belongs to next week. Otherwise a bare weekday ("ביום שלישי", "הקרוב") is the nearest such day after the reference date.',
    '- An explicit date (e.g. 20/10/2026 or 20.10) always wins. Dates are day-first.',
    '- "time" is when the players must be at the location, 24-hour HH:MM: the arrival time ("הגעה", "יש להגיע עד") when one is given, otherwise the start time.',
    '- If players gather somewhere for team transport ("הסעה מ..."), "time" is the gathering time and "location" is the gathering place; put the game venue and start time in "notes".',
    '- "location": the place exactly as written, in the original language (e.g. "סינתטי גדול, בית דני"). null when the place is not known yet.',
    '- "kind": "game" for any match (משחק, ליגה, גביע, מחזור, against/vs an opponent: נגד / מול); otherwise "practice".',
    '- "title": a short label for a game in the message\'s language, e.g. "משחק ליגה, מחזור 1 – מעלה אדומים (חוץ)". null for ordinary practices.',
    '- "notes": short practical details for parents, in the message\'s language — game start time when it differs from "time", kit/uniform, transport, "address to be announced". null when there are none. No greetings or cheering.',
    '- "cancellations": days the message explicitly says have no team practice or game (e.g. "אין אימונים בשלישי").',
    '- "fullSchedule": true only when the message lays out the complete practice schedule for a period (e.g. "לוז לשבוע הבא", "לוז אימונים שבוע הבא"); then periodStart/periodEnd are that period\'s Sunday and Saturday. false for a message about one game or one change.',
    "- \"unresolved\": one short line, in the message's language, for each schedule item mentioned without a usable date or time (e.g. a game whose date is still pending), and for outings that aren't the team's own practice or game (e.g. attending a professional match). Leave out greetings, ticket logistics and requests to reply.",
    '- Never invent an event that the message does not state.',
    '',
    'Calendar:',
    calendar,
  ].join('\n');
}

/** An existing session, reduced to what the planner compares against. */
export interface PlannerSession {
  id: string;
  startsAt: Date;
  fieldLocation: string;
  kind: SessionKind;
  title: string | null;
  notes: string | null;
  status: 'scheduled' | 'completed' | 'cancelled';
  updatedAt: Date;
}

function truncate(value: string | null, max: number): string | null {
  return value === null ? null : value.slice(0, max);
}

function fieldsOf(session: PlannerSession, timeZone: string): ScheduleImportSessionFields {
  const { date, time } = instantToWallClock(session.startsAt, timeZone);
  return {
    date,
    time,
    kind: session.kind,
    title: session.title,
    fieldLocation: session.fieldLocation,
    notes: session.notes,
  };
}

function sameFields(a: ScheduleImportSessionFields, b: ScheduleImportSessionFields): boolean {
  return (
    a.date === b.date &&
    a.time === b.time &&
    a.kind === b.kind &&
    a.title === b.title &&
    a.fieldLocation === b.fieldLocation &&
    a.notes === b.notes
  );
}

function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function normalizeTime(time: string): string {
  const [hours = '0', minutes = '00'] = time.split(':');
  return `${hours.padStart(2, '0')}:${minutes}`;
}

/**
 * Builds the proposal. Each extracted event is matched to at most one
 * existing scheduled session on the same local date — preferring the same
 * kind, then the closest time — and becomes an `update` (if anything
 * actually differs) or, with no match, a `create`. Explicit cancellations
 * cancel the remaining sessions on that date (of that kind, if stated). When
 * the message is a full schedule for a period, practices in that period it
 * doesn't mention are proposed for cancellation too — games are left alone,
 * since a practice-schedule message routinely omits a game announced
 * separately. Past days are never touched.
 *
 * With `replaceWeek`, matching is skipped for the message's week instead:
 * every upcoming session that week (practices and games alike) is proposed
 * for cancellation, and every event the message gives for that week becomes
 * a new session. The week is the message's own full-schedule period when it
 * has one, otherwise the Sunday–Saturday week of its earliest event. Events
 * outside that week are still matched as usual.
 */
export function planOperations(input: {
  extraction: ScheduleExtraction;
  sessions: PlannerSession[];
  timeZone: string;
  now: Date;
  /** Used for a new session whose place the message doesn't give yet. */
  locationPlaceholder: string;
  replaceWeek?: boolean;
}): {
  operations: ScheduleImportOperation[];
  unresolved: string[];
  replacedWeek: { start: string; end: string } | null;
} {
  const { extraction, timeZone, now } = input;
  const today = instantToWallClock(now, timeZone).date;
  const lastAllowed = DateTime.fromISO(today, { zone: 'utc' })
    .plus({ days: MAX_DAYS_AHEAD })
    .toFormat('yyyy-MM-dd');
  const inRange = (date: string) => date >= today && date <= lastAllowed;

  const candidates = input.sessions
    .filter((session) => session.status === 'scheduled')
    .map((session) => ({ session, fields: fieldsOf(session, timeZone) }))
    .filter(({ fields }) => fields.date >= today);
  const claimed = new Set<string>();

  const operations: ScheduleImportOperation[] = [];
  const unresolved = [...extraction.unresolved];
  const seenEvents = new Set<string>();

  const events = [...extraction.events].sort((a, b) =>
    `${a.date} ${normalizeTime(a.time)}`.localeCompare(`${b.date} ${normalizeTime(b.time)}`),
  );

  // A "full schedule" covers one week at most. Without this bound, one
  // pasted message claiming to be the schedule for months ahead would
  // propose cancelling every practice in that span.
  const period =
    extraction.fullSchedule &&
    extraction.periodStart &&
    extraction.periodEnd &&
    extraction.periodStart <= extraction.periodEnd &&
    DateTime.fromISO(extraction.periodEnd, { zone: 'utc' }).diff(
      DateTime.fromISO(extraction.periodStart, { zone: 'utc' }),
      'days',
    ).days <=
      MAX_FULL_SCHEDULE_DAYS - 1
      ? { start: extraction.periodStart, end: extraction.periodEnd }
      : null;

  const firstEvent = events.find((event) => inRange(event.date));
  const replacedWeek = !input.replaceWeek
    ? null
    : (period ?? (firstEvent ? sundayToSaturdayWeekOf(firstEvent.date) : null));

  if (replacedWeek) {
    // Claimed up front, so the event loop below finds nothing to match in
    // this week and creates every event fresh.
    for (const { session, fields } of candidates) {
      if (fields.date < replacedWeek.start || fields.date > replacedWeek.end) continue;
      claimed.add(session.id);
      operations.push({
        type: 'cancel',
        sessionId: session.id,
        expectedUpdatedAt: session.updatedAt.toISOString(),
        before: fields,
        reason: 'replaced',
      });
    }
  }

  for (const event of events) {
    const time = normalizeTime(event.time);
    const key = `${event.date} ${time} ${event.kind}`;
    if (seenEvents.has(key)) continue;
    seenEvents.add(key);
    if (!inRange(event.date)) continue;

    const sameDay = candidates.filter(
      ({ session, fields }) => !claimed.has(session.id) && fields.date === event.date,
    );
    const ranked = [...sameDay].sort((a, b) => {
      const kindRank = Number(a.fields.kind !== event.kind) - Number(b.fields.kind !== event.kind);
      if (kindRank !== 0) return kindRank;
      return (
        Math.abs(minutesOf(a.fields.time) - minutesOf(time)) -
        Math.abs(minutesOf(b.fields.time) - minutesOf(time))
      );
    });
    const match = ranked[0];

    if (!match) {
      operations.push({
        type: 'create',
        after: {
          date: event.date,
          time,
          kind: event.kind,
          title: truncate(event.title, 255),
          fieldLocation: truncate(event.location ?? input.locationPlaceholder, 255)!,
          notes: truncate(event.notes, 1000),
        },
      });
      continue;
    }

    claimed.add(match.session.id);
    const keepsKind = match.fields.kind === event.kind;
    const after: ScheduleImportSessionFields = {
      date: event.date,
      time,
      kind: event.kind,
      title: truncate(event.title ?? (keepsKind ? match.fields.title : null), 255),
      // A practice slot turning into a game (an away game, say) doesn't
      // happen at the practice field just because the message hasn't given
      // the venue yet.
      fieldLocation: truncate(
        event.location ?? (keepsKind ? match.fields.fieldLocation : input.locationPlaceholder),
        255,
      )!,
      notes: truncate(event.notes ?? (keepsKind ? match.fields.notes : null), 1000),
    };
    if (sameFields(match.fields, after)) continue;
    operations.push({
      type: 'update',
      sessionId: match.session.id,
      expectedUpdatedAt: match.session.updatedAt.toISOString(),
      before: match.fields,
      after,
    });
  }

  for (const cancellation of extraction.cancellations) {
    for (const { session, fields } of candidates) {
      if (claimed.has(session.id) || fields.date !== cancellation.date) continue;
      if (cancellation.kind && fields.kind !== cancellation.kind) continue;
      claimed.add(session.id);
      operations.push({
        type: 'cancel',
        sessionId: session.id,
        expectedUpdatedAt: session.updatedAt.toISOString(),
        before: fields,
        reason: 'explicit',
      });
    }
  }

  if (period) {
    for (const { session, fields } of candidates) {
      if (claimed.has(session.id) || fields.kind !== 'practice') continue;
      if (fields.date < period.start || fields.date > period.end) continue;
      claimed.add(session.id);
      operations.push({
        type: 'cancel',
        sessionId: session.id,
        expectedUpdatedAt: session.updatedAt.toISOString(),
        before: fields,
        reason: 'not_in_message',
      });
    }
  }

  const dateOf = (operation: ScheduleImportOperation) => {
    const fields = operation.type === 'cancel' ? operation.before : operation.after;
    return `${fields.date} ${fields.time}`;
  };
  operations.sort((a, b) => dateOf(a).localeCompare(dateOf(b)));

  return { operations, unresolved, replacedWeek };
}

function sundayToSaturdayWeekOf(date: string): { start: string; end: string } {
  const day = DateTime.fromISO(date, { zone: 'utc' });
  // Luxon weekdays run Monday=1 … Sunday=7.
  const sunday = day.minus({ days: day.weekday % 7 });
  return {
    start: sunday.toFormat('yyyy-MM-dd'),
    end: sunday.plus({ days: 6 }).toFormat('yyyy-MM-dd'),
  };
}
