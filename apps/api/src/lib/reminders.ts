import { REMINDER_OFFSET_MINUTES_DEFAULT } from '@soccer/contracts';
import type { Prisma } from '../../generated/prisma/client';

export interface ScheduledReminder {
  id: string;
  runAt: Date;
}

/** Finds the pending `reminder` `ScheduledTask`s for one shift, by payload
 *  (no stored foreign key — same reasoning as `cancelPendingExpiryTask` for
 *  swap expiry: cheap at this app's scale, and avoids a schema field only
 *  ever read here). */
async function cancelPendingRemindersForShift(
  tx: Prisma.TransactionClient,
  shiftId: string,
): Promise<void> {
  await tx.scheduledTask.updateMany({
    where: {
      type: 'reminder',
      payload: { path: ['shiftId'], equals: shiftId },
      completedAt: null,
      cancelledAt: null,
    },
    data: { cancelledAt: new Date() },
  });
}

/**
 * Re-derives one shift's reminder schedule from scratch: cancels whatever
 * pending `reminder` tasks it already has, then — if the shift is currently
 * claimed by someone, for a session that's still scheduled and in the
 * future — creates a fresh one per effective offset (the assignee's own
 * `MemberNotificationSettings.reminderOffsetMinutes` override if they have
 * one, else the team's `CoordinationSettings.reminderOffsetMinutes`
 * default). Always cancel-then-recreate rather than diffing the old set
 * against the new one — simpler, and this runs inside the same transaction
 * as whatever mutation triggered it, so it's cheap relative to that write.
 *
 * An offset whose resulting `runAt` has already passed (e.g. claiming a
 * shift 30 minutes before it starts, with a 24-hour-before offset
 * configured) is silently skipped — there's nothing useful left to remind
 * about for that particular offset.
 *
 * Call this after anything that can change a shift's assignee or a
 * session's start time — claim, release, swap acceptance, member removal,
 * a session edit/cancel — so the reminder schedule never drifts from
 * reality. Returns the newly created tasks (for the caller to best-effort
 * enqueue after the transaction commits); an empty array if the shift ended
 * up with nothing to schedule.
 */
export async function syncShiftReminders(
  tx: Prisma.TransactionClient,
  shiftId: string,
): Promise<ScheduledReminder[]> {
  await cancelPendingRemindersForShift(tx, shiftId);

  const shift = await tx.shift.findUnique({
    where: { id: shiftId },
    include: { session: true },
  });
  if (!shift?.assignedUserId) return [];
  if (shift.session.status !== 'scheduled') return [];
  const now = Date.now();
  if (shift.session.startsAt.getTime() <= now) return [];

  const teamId = shift.session.teamId;
  const [teamSettings, memberSettings] = await Promise.all([
    tx.coordinationSettings.findUnique({ where: { teamId } }),
    tx.memberNotificationSettings.findUnique({
      where: { userId_teamId: { userId: shift.assignedUserId, teamId } },
    }),
  ]);
  const offsets = memberSettings?.reminderOffsetMinutes.length
    ? memberSettings.reminderOffsetMinutes
    : (teamSettings?.reminderOffsetMinutes ?? REMINDER_OFFSET_MINUTES_DEFAULT);

  const created: ScheduledReminder[] = [];
  for (const offsetMinutes of offsets) {
    const runAt = new Date(shift.session.startsAt.getTime() - offsetMinutes * 60_000);
    if (runAt.getTime() <= now) continue;
    const task = await tx.scheduledTask.create({
      data: {
        teamId,
        type: 'reminder',
        payload: { shiftId, userId: shift.assignedUserId },
        runAt,
      },
    });
    created.push({ id: task.id, runAt });
  }
  return created;
}

/** `syncShiftReminders` over several shifts at once (a session's shifts on
 *  a time/cancel edit), flattening every newly created task into one list. */
export async function syncRemindersForShifts(
  tx: Prisma.TransactionClient,
  shiftIds: string[],
): Promise<ScheduledReminder[]> {
  const created: ScheduledReminder[] = [];
  for (const shiftId of shiftIds) {
    created.push(...(await syncShiftReminders(tx, shiftId)));
  }
  return created;
}

/** Every currently-claimed, future, still-scheduled shift on `teamId` whose
 *  assignee has *no* personal reminder-offset override — the set that
 *  actually changes effective offsets when the team's own default changes. */
export async function findShiftIdsUsingTeamDefaultOffsets(
  tx: Prisma.TransactionClient,
  teamId: string,
): Promise<string[]> {
  const overridden = await tx.memberNotificationSettings.findMany({
    where: { teamId, reminderOffsetMinutes: { isEmpty: false } },
    select: { userId: true },
  });
  const shifts = await tx.shift.findMany({
    where: {
      status: 'claimed',
      assignedUserId: { notIn: overridden.map((m) => m.userId) },
      session: { teamId, status: 'scheduled', startsAt: { gt: new Date() } },
    },
    select: { id: true },
  });
  return shifts.map((s) => s.id);
}

/** Every currently-claimed, future, still-scheduled shift assigned to one
 *  member on one team — the set that changes when *their own* reminder
 *  override is set, changed, or cleared. */
export async function findShiftIdsForMember(
  tx: Prisma.TransactionClient,
  userId: string,
  teamId: string,
): Promise<string[]> {
  const shifts = await tx.shift.findMany({
    where: {
      status: 'claimed',
      assignedUserId: userId,
      session: { teamId, status: 'scheduled', startsAt: { gt: new Date() } },
    },
    select: { id: true },
  });
  return shifts.map((s) => s.id);
}
