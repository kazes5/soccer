import type { PracticeSession, ShiftSummary } from '@soccer/contracts';
import { formatDate, type Locale } from '@soccer/i18n';

/** Patches a single shift in place across a session list, avoiding a full refetch after claim/release. */
export function updateShiftInSessions(
  sessions: PracticeSession[],
  shiftId: string,
  updated: ShiftSummary,
): PracticeSession[] {
  return sessions.map((session) => ({
    ...session,
    points: session.points.map((point) =>
      point.shift.id === shiftId ? { ...point, shift: updated } : point,
    ),
  }));
}

/** Shared date/time format for a session's `startsAt` across the Schedule and Home pages. */
export function formatSessionStartsAt(locale: Locale, startsAt: string): string {
  return formatDate(locale, new Date(startsAt), {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    // `startsAt` is stored as literal wall-clock numbers, not a true
    // timezone-aware instant (see PLAN.md's Stage 3 recurrence note) — pinning
    // the formatter to UTC displays exactly what was entered/generated,
    // regardless of the viewer's own browser timezone. Real per-team
    // IANA-timezone conversion is Stage 4's job (reminders/escalation).
    timeZone: 'UTC',
  });
}
