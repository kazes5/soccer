import { QUIET_HOURS_END_DEFAULT, QUIET_HOURS_START_DEFAULT } from '@soccer/contracts';
import type { Queue } from 'bullmq';
import type { PrismaClient, ScheduledTask } from '../../../generated/prisma/client';
import { recordAuditLog } from '../../lib/audit';
import { recordOutboxEvent } from '../../lib/outbox';
import { enqueueOutboxEvent, enqueueScheduledTask } from '../../lib/queues';
import { loadSwapRequestWithRelations, resolveSwapRequestOutcome } from '../../lib/swap-requests';
import { isWithinQuietHours, nextQuietHoursEndInstant } from '../../lib/timezone';

async function processSwapExpiry(
  prisma: PrismaClient,
  task: ScheduledTask,
  outboxQueue?: Queue<{ outboxEventId: string }>,
): Promise<void> {
  const payload = task.payload as { swapRequestId?: string };
  if (typeof payload.swapRequestId !== 'string') return;

  const existing = await loadSwapRequestWithRelations(prisma, payload.swapRequestId);
  // Already resolved by a human (accept/decline/cancel) before this fired —
  // that path already cancelled this very task, but the delayed BullMQ job
  // can still land moments later; a no-op here is correct either way.
  if (!existing || existing.status !== 'pending') return;

  const outboxEventId = await prisma.$transaction((tx) =>
    resolveSwapRequestOutcome(tx, existing, 'expired', null),
  );

  if (outboxQueue) {
    await enqueueOutboxEvent(outboxQueue, outboxEventId).catch(() => {
      // Best-effort, same reasoning as every other post-commit enqueue in
      // this codebase — the outbox worker's own startup reconciliation
      // picks up any event still missing `processedAt`.
    });
  }
}

/**
 * Fires one pre-shift reminder (CLAUDE.md §3.11). Revalidates everything
 * live rather than trusting the payload's snapshot — `syncShiftReminders`
 * (the scheduling side, in `apps/api/src/lib/reminders.ts`) cancels a
 * shift's pending reminders on every assignment/session change it knows
 * about, but a delayed BullMQ job can still be mid-flight when one of those
 * happens, so a defensive re-check here is the only way to guarantee a
 * stale reminder never goes out:
 *
 * - the shift must still be assigned to the exact user this task was
 *   scheduled for (an `open` shift has no assignee at all; a *reassigned*
 *   one — the only way `assignedUserId` changes without an assignee
 *   becoming null — now belongs to someone else's own reminder tasks. A
 *   shift merely `pending_swap` is *not* reassigned yet, so its current
 *   holder still gets reminded, deliberately not excluded here);
 * - the session must still be `scheduled` and still in the future.
 *
 * Quiet hours *defer* rather than skip (unlike push delivery's own
 * quiet-hours gate for every other event type) — a brand new `ScheduledTask`
 * is created for the moment quiet hours end and this one is left to
 * complete normally, per PLAN.md's explicit "defer... until quiet hours
 * end" instruction. If that deferred moment would itself land after the
 * session starts, there's nothing useful left to defer to, so the reminder
 * is suppressed instead — this is the "or suppress them if the session has
 * passed" half of the same instruction, applied pre-emptively.
 */
async function processReminder(
  prisma: PrismaClient,
  task: ScheduledTask,
  outboxQueue?: Queue<{ outboxEventId: string }>,
  scheduledTaskQueue?: Queue<{ scheduledTaskId: string }>,
  now: Date = new Date(),
): Promise<void> {
  const rawPayload = task.payload as { shiftId?: string; userId?: string };
  if (typeof rawPayload.shiftId !== 'string' || typeof rawPayload.userId !== 'string') return;
  // Reassigned to plain locals (not just narrowed) so every closure below —
  // notably the `$transaction` callback — keeps TypeScript's `string`
  // narrowing; a property access like `rawPayload.userId` loses it across a
  // function boundary even though `rawPayload` itself is never reassigned.
  const shiftId = rawPayload.shiftId;
  const userId = rawPayload.userId;

  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: { session: true, point: true },
  });
  if (!shift || shift.assignedUserId !== userId) return;
  if (shift.session.status !== 'scheduled' || shift.session.startsAt.getTime() <= now.getTime()) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, languagePreference: true, isActive: true },
  });
  if (!user?.isActive) return;

  const teamId = shift.session.teamId;
  const [team, teamSettings, memberSettings] = await Promise.all([
    prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { timezone: true } }),
    prisma.teamNotificationSettings.findUnique({ where: { teamId } }),
    prisma.memberNotificationSettings.findUnique({
      where: { userId_teamId: { userId, teamId } },
    }),
  ]);
  const quietHoursStart =
    memberSettings?.quietHoursStart ?? teamSettings?.quietHoursStart ?? QUIET_HOURS_START_DEFAULT;
  const quietHoursEnd =
    memberSettings?.quietHoursEnd ?? teamSettings?.quietHoursEnd ?? QUIET_HOURS_END_DEFAULT;

  if (isWithinQuietHours(now, team.timezone, quietHoursStart, quietHoursEnd)) {
    const deferredRunAt = nextQuietHoursEndInstant(now, team.timezone, quietHoursEnd);
    if (deferredRunAt.getTime() >= shift.session.startsAt.getTime()) return; // would land after the session starts

    const deferred = await prisma.scheduledTask.create({
      data: {
        teamId,
        type: 'reminder',
        payload: { shiftId, userId },
        runAt: deferredRunAt,
      },
    });
    if (scheduledTaskQueue) {
      await enqueueScheduledTask(scheduledTaskQueue, deferred.id, deferredRunAt).catch(() => {});
    }
    return;
  }

  const assignment = await prisma.sessionPointAssignment.findUnique({
    where: {
      sessionId_pointId_direction: {
        sessionId: shift.sessionId,
        pointId: shift.pointId,
        direction: shift.direction,
      },
    },
  });
  const players =
    assignment && assignment.playerIds.length > 0
      ? await prisma.player.findMany({
          where: { id: { in: assignment.playerIds } },
          select: { name: true },
        })
      : [];

  const outboxEventId = await prisma.$transaction(async (tx) => {
    await recordAuditLog(tx, {
      teamId,
      actorId: null,
      actionType: 'reminder_sent',
      targetEntity: 'shift',
      targetId: shift.id,
      afterState: { userId },
    });

    const outboxEvent = await recordOutboxEvent(tx, {
      teamId,
      eventType: 'shift_reminder',
      category: 'reminders',
      recipientScope: { type: 'self', userId },
      payload: {
        shiftId: shift.id,
        sessionId: shift.sessionId,
        pointId: shift.pointId,
        pointName: shift.point.name,
        direction: shift.direction,
        sessionStartsAt: shift.session.startsAt.toISOString(),
        fieldLocation: shift.session.fieldLocation,
        playerNames: players.map((p) => p.name),
      },
    });
    return outboxEvent.id;
  });

  if (outboxQueue) {
    await enqueueOutboxEvent(outboxQueue, outboxEventId).catch(() => {});
  }
}

/**
 * Idempotent: a no-op if the task is missing, already completed, or
 * cancelled. `escalation` is the only concrete task type without real
 * business logic yet — that's Checkpoint 10.
 */
export async function processScheduledTask(
  prisma: PrismaClient,
  scheduledTaskId: string,
  outboxQueue?: Queue<{ outboxEventId: string }>,
  scheduledTaskQueue?: Queue<{ scheduledTaskId: string }>,
  now: Date = new Date(),
): Promise<void> {
  const task = await prisma.scheduledTask.findUnique({ where: { id: scheduledTaskId } });
  if (!task || task.completedAt || task.cancelledAt) return;

  if (task.type === 'swap_expiry') {
    await processSwapExpiry(prisma, task, outboxQueue);
  } else if (task.type === 'reminder') {
    await processReminder(prisma, task, outboxQueue, scheduledTaskQueue, now);
  }

  await prisma.scheduledTask.update({
    where: { id: task.id },
    data: { completedAt: new Date() },
  });
}
