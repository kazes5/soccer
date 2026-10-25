import { describe, expect, it } from 'vitest';
import {
  buildExtractionPrompt,
  parseExtraction,
  planOperations,
  type PlannerSession,
  type ScheduleExtraction,
} from './schedule-import';
import { localDateTimeToInstant } from './timezone';

const TZ = 'Asia/Jerusalem';
// Saturday 2026-10-24, the day a "שבת שלום, לוז אימונים שבוע הבא" message
// goes out; next week is Sunday 10-25 .. Saturday 10-31.
const NOW = localDateTimeToInstant('2026-10-24', '10:00', TZ);
const PLACEHOLDER = 'מיקום יימסר בהמשך';
const UPDATED_AT = new Date('2026-10-01T00:00:00.000Z');

let nextId = 0;
function session(
  date: string,
  time: string,
  overrides: Partial<PlannerSession> = {},
): PlannerSession {
  nextId += 1;
  return {
    id: `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`,
    startsAt: localDateTimeToInstant(date, time, TZ),
    fieldLocation: 'בית דני',
    kind: 'practice',
    title: null,
    notes: null,
    status: 'scheduled',
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function extraction(overrides: Partial<ScheduleExtraction>): ScheduleExtraction {
  return {
    events: [],
    cancellations: [],
    fullSchedule: false,
    periodStart: null,
    periodEnd: null,
    unresolved: [],
    ...overrides,
  };
}

function plan(input: { extraction: ScheduleExtraction; sessions: PlannerSession[] }) {
  return planOperations({ ...input, timeZone: TZ, now: NOW, locationPlaceholder: PLACEHOLDER });
}

describe('planOperations', () => {
  it('turns a full-week practice message into updates and cancellations (sample 3)', () => {
    // A Sun–Thu 17:30 template at בית דני; the coach moves most days and
    // says there's no practice on Tuesday.
    const sunday = session('2026-10-25', '17:30');
    const monday = session('2026-10-26', '17:30');
    const tuesday = session('2026-10-27', '17:30');
    const wednesday = session('2026-10-28', '17:30');
    const thursday = session('2026-10-29', '17:30');

    const result = plan({
      sessions: [sunday, monday, tuesday, wednesday, thursday],
      extraction: extraction({
        events: [
          {
            date: '2026-10-25',
            time: '17:30',
            kind: 'practice',
            title: null,
            location: 'בית דני',
            notes: null,
          },
          {
            date: '2026-10-26',
            time: '19:00',
            kind: 'practice',
            title: null,
            location: 'בית דני',
            notes: null,
          },
          {
            date: '2026-10-28',
            time: '16:00',
            kind: 'practice',
            title: null,
            location: 'בית דני',
            notes: null,
          },
          {
            date: '2026-10-29',
            time: '19:45',
            kind: 'practice',
            title: null,
            location: 'כפר שלם',
            notes: null,
          },
        ],
        cancellations: [{ date: '2026-10-27', kind: 'practice' }],
        fullSchedule: true,
        periodStart: '2026-10-25',
        periodEnd: '2026-10-31',
        unresolved: ['גמר גביע הטוטו של בני יהודה ביום שלישי – כרטיסים לילדים'],
      }),
    });

    // Sunday already matches, so it isn't proposed at all.
    expect(result.operations.map((op) => op.type)).toEqual([
      'update',
      'cancel',
      'update',
      'update',
    ]);
    expect(result.operations[0]).toMatchObject({
      type: 'update',
      sessionId: monday.id,
      before: { time: '17:30' },
      after: { date: '2026-10-26', time: '19:00', fieldLocation: 'בית דני' },
      expectedUpdatedAt: UPDATED_AT.toISOString(),
    });
    expect(result.operations[1]).toMatchObject({
      type: 'cancel',
      sessionId: tuesday.id,
      reason: 'explicit',
    });
    expect(result.operations[3]).toMatchObject({
      sessionId: thursday.id,
      after: { time: '19:45', fieldLocation: 'כפר שלם' },
    });
    expect(result.unresolved).toEqual(['גמר גביע הטוטו של בני יהודה ביום שלישי – כרטיסים לילדים']);
  });

  it('turns a practice into a game, without keeping the practice field as the venue (sample 2)', () => {
    const friday = session('2026-10-30', '12:00', { fieldLocation: 'סינתטי גדול, בית דני' });

    const result = plan({
      sessions: [friday],
      extraction: extraction({
        events: [
          {
            date: '2026-10-30',
            time: '12:00',
            kind: 'game',
            title: 'משחק גביע המדינה',
            location: null,
            notes: 'תחילת משחק 13:00, תלבושת כתומה, כתובת המגרש בכפר סבא תימסר',
          },
        ],
      }),
    });

    expect(result.operations).toEqual([
      expect.objectContaining({
        type: 'update',
        sessionId: friday.id,
        after: {
          date: '2026-10-30',
          time: '12:00',
          kind: 'game',
          title: 'משחק גביע המדינה',
          fieldLocation: PLACEHOLDER,
          notes: 'תחילת משחק 13:00, תלבושת כתומה, כתובת המגרש בכפר סבא תימסר',
        },
      }),
    ]);
  });

  it('creates a session for a game on a day with nothing scheduled (sample 4)', () => {
    const result = plan({
      sessions: [session('2026-10-26', '19:00')],
      extraction: extraction({
        events: [
          {
            date: '2026-11-03',
            time: '17:00',
            kind: 'game',
            title: 'משחק ליגה, מחזור 1 – מעלה אדומים (חוץ)',
            location: 'בית דני',
            notes: 'הסעה יוצאת 17:15, תחילת משחק 20:00, מדים כתומים סט מלא',
          },
        ],
      }),
    });

    expect(result.operations).toEqual([
      {
        type: 'create',
        after: {
          date: '2026-11-03',
          time: '17:00',
          kind: 'game',
          title: 'משחק ליגה, מחזור 1 – מעלה אדומים (חוץ)',
          fieldLocation: 'בית דני',
          notes: 'הסעה יוצאת 17:15, תחילת משחק 20:00, מדים כתומים סט מלא',
        },
      },
    ]);
  });

  it('matches a game and a practice on the same day to the session of the same kind', () => {
    const practice = session('2026-10-27', '17:00');
    const game = session('2026-10-27', '19:00', { kind: 'game', title: 'גביע' });

    const result = plan({
      sessions: [practice, game],
      extraction: extraction({
        events: [
          {
            date: '2026-10-27',
            time: '18:45',
            kind: 'game',
            title: null,
            location: 'ספורטק דרום',
            notes: null,
          },
        ],
      }),
    });

    expect(result.operations).toEqual([
      expect.objectContaining({
        sessionId: game.id,
        // No new title in the message, same kind: the existing one is kept.
        after: expect.objectContaining({
          time: '18:45',
          title: 'גביע',
          fieldLocation: 'ספורטק דרום',
        }),
      }),
    ]);
  });

  it('never cancels a game just because a full practice schedule omits it', () => {
    const game = session('2026-10-31', '11:00', { kind: 'game' });
    const practice = session('2026-10-28', '17:00');

    const result = plan({
      sessions: [game, practice],
      extraction: extraction({
        events: [],
        fullSchedule: true,
        periodStart: '2026-10-25',
        periodEnd: '2026-10-31',
      }),
    });

    expect(result.operations).toEqual([
      expect.objectContaining({ type: 'cancel', sessionId: practice.id, reason: 'not_in_message' }),
    ]);
  });

  it("leaves sessions alone outside the message's period, and ignores past days and duplicates", () => {
    const yesterday = session('2026-10-23', '17:00');
    const later = session('2026-11-10', '17:00');

    const result = plan({
      sessions: [yesterday, later],
      extraction: extraction({
        events: [
          {
            date: '2026-10-23',
            time: '18:00',
            kind: 'practice',
            title: null,
            location: null,
            notes: null,
          },
          {
            date: '2026-10-26',
            time: '9:30',
            kind: 'practice',
            title: null,
            location: null,
            notes: null,
          },
          {
            date: '2026-10-26',
            time: '09:30',
            kind: 'practice',
            title: null,
            location: null,
            notes: null,
          },
          {
            date: '2030-01-01',
            time: '09:30',
            kind: 'practice',
            title: null,
            location: null,
            notes: null,
          },
        ],
        cancellations: [{ date: '2026-10-23', kind: null }],
        fullSchedule: true,
        periodStart: '2026-10-25',
        periodEnd: '2026-10-31',
      }),
    });

    expect(result.operations).toEqual([
      {
        type: 'create',
        after: {
          date: '2026-10-26',
          time: '09:30',
          kind: 'practice',
          title: null,
          fieldLocation: PLACEHOLDER,
          notes: null,
        },
      },
    ]);
  });

  it('ignores cancelled sessions when matching', () => {
    const cancelled = session('2026-10-26', '17:00', { status: 'cancelled' });

    const result = plan({
      sessions: [cancelled],
      extraction: extraction({
        events: [
          {
            date: '2026-10-26',
            time: '17:00',
            kind: 'practice',
            title: null,
            location: 'בית דני',
            notes: null,
          },
        ],
      }),
    });

    expect(result.operations).toEqual([expect.objectContaining({ type: 'create' })]);
  });
});

describe('planOperations full-schedule bound', () => {
  it('ignores a "full schedule" claim spanning more than one week', () => {
    const result = plan({
      sessions: [session('2026-10-28', '17:00'), session('2026-11-20', '17:00')],
      extraction: extraction({
        fullSchedule: true,
        periodStart: '2026-10-25',
        periodEnd: '2027-01-31',
      }),
    });
    expect(result.operations).toEqual([]);
  });
});

describe('parseExtraction', () => {
  it('keeps well-formed entries and drops malformed ones', () => {
    const parsed = parseExtraction({
      events: [
        { date: '2026-10-26', time: '19:00', kind: 'practice', location: ' בית דני ', notes: '' },
        { date: 'Monday', time: '19:00' },
        { date: '2026-10-27', time: '25:00' },
        { date: '2026-10-28', time: '18:00', kind: 'tournament' },
      ],
      cancellations: [{ date: '2026-10-27' }, { date: 'tuesday' }],
      fullSchedule: 'yes',
      periodStart: '2026-10-25',
      periodEnd: 'soon',
      unresolved: ['משחק גביע – מועד טרם נקבע', 42, '   '],
    });

    expect(parsed).toEqual({
      events: [
        {
          date: '2026-10-26',
          time: '19:00',
          kind: 'practice',
          title: null,
          location: 'בית דני',
          notes: null,
        },
        {
          date: '2026-10-28',
          time: '18:00',
          kind: 'practice',
          title: null,
          location: null,
          notes: null,
        },
      ],
      cancellations: [{ date: '2026-10-27' }],
      fullSchedule: false,
      periodStart: '2026-10-25',
      periodEnd: null,
      unresolved: ['משחק גביע – מועד טרם נקבע'],
    });
  });

  it('treats a non-object reply as an empty extraction', () => {
    expect(parseExtraction('nope')).toEqual({
      events: [],
      cancellations: [],
      fullSchedule: false,
      periodStart: null,
      periodEnd: null,
      unresolved: [],
    });
  });
});

describe('buildExtractionPrompt', () => {
  it('prints a calendar starting at the reference date, with Hebrew weekday names', () => {
    const prompt = buildExtractionPrompt('2026-10-24');
    expect(prompt).toContain('2026-10-24 Saturday (שבת) <- reference date');
    expect(prompt).toContain('2026-10-25 Sunday (ראשון)');
    expect(prompt).toContain('2026-10-27 Tuesday (שלישי)');
    expect(prompt).toContain('2026-11-13 Friday (שישי)');
  });
});
