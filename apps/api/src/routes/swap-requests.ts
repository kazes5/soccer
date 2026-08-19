import {
  SWAP_EXPIRY_HOURS_DEFAULT,
  swapRequestListResponseSchema,
  swapRequestSchema,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAuditLog } from '../lib/audit';
import { requireAuth, requireTeamRole } from '../lib/authorization';
import { HttpError } from '../lib/errors';
import { recordOutboxEvent } from '../lib/outbox';
import {
  enqueueOutboxEventBestEffort,
  enqueueScheduledTask,
  enqueueScheduledTaskBestEffort,
} from '../lib/queues';
import { syncShiftReminders } from '../lib/reminders';
import { recordScheduledTask } from '../lib/scheduled-tasks';
import {
  cancelPendingExpiryTask,
  loadSwapRequestWithRelations,
  resolveSwapRequestOutcome,
  swapRequestInclude,
  toSwapRequestDto,
} from '../lib/swap-requests';
import { isPastCalendarDay } from '../lib/timezone';

const teamParamsSchema = z.object({ teamId: z.string().uuid() });
const shiftParamsSchema = z.object({ teamId: z.string().uuid(), shiftId: z.string().uuid() });
const swapRequestParamsSchema = z.object({
  teamId: z.string().uuid(),
  swapRequestId: z.string().uuid(),
});

export default async function swapRequestRoutes(app: FastifyInstance) {
  // Every team member can see every swap request, not just their own — the
  // same "transparent schedule" philosophy CLAUDE.md applies to shifts
  // (§3.6) extends to who's asked to take over whose shift. The web client
  // derives "needs your response" / "your requests" / read-only "team
  // activity" groupings from `requestingUserId`/`currentHolderId` client-
  // side, the same way Schedule derives `canClaim`/`canRelease` from shift
  // fields rather than the server pre-computing per-viewer booleans.
  app.get('/teams/:teamId/swap-requests', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const swapRequests = await app.prisma.swapRequest.findMany({
      where: { teamId: params.teamId },
      include: swapRequestInclude,
      orderBy: { createdAt: 'desc' },
    });

    return swapRequestListResponseSchema.parse({
      swapRequests: swapRequests.map(toSwapRequestDto),
    });
  });

  app.post('/teams/:teamId/shifts/:shiftId/swap-requests', async (request) => {
    const params = shiftParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const shift = await app.prisma.shift.findUnique({
      where: { id: params.shiftId },
      include: { session: { include: { team: { select: { timezone: true } } } }, point: true },
    });
    if (!shift || shift.session.teamId !== params.teamId) {
      throw new HttpError(404, 'Shift not found.');
    }
    if (shift.session.status !== 'scheduled') {
      throw new HttpError(409, 'This session is no longer scheduled.');
    }
    if (isPastCalendarDay(shift.session.startsAt, shift.session.team.timezone)) {
      throw new HttpError(409, 'This session has already happened and can no longer be swapped.');
    }
    if (shift.status !== 'claimed' || !shift.assignedUserId) {
      throw new HttpError(409, 'This shift is not currently held by anyone to request.');
    }
    if (shift.assignedUserId === currentUser.id) {
      throw new HttpError(400, 'You already hold this shift.');
    }

    const settings = await app.prisma.coordinationSettings.findUnique({
      where: { teamId: params.teamId },
    });
    const swapExpiryHours = settings?.swapExpiryHours ?? SWAP_EXPIRY_HOURS_DEFAULT;
    // Capped at the session's own start time (PLAN.md's explicit instruction)
    // — a swap decision is meaningless once the shift it's for has begun.
    const expiresAt = new Date(
      Math.min(Date.now() + swapExpiryHours * 60 * 60 * 1000, shift.session.startsAt.getTime()),
    );
    const holderId = shift.assignedUserId;

    const created = await app.prisma.$transaction(async (tx) => {
      // Predicated on status AND version, same CAS discipline as claim/
      // release — also this checkpoint's primary guard against a second
      // concurrent swap request for the same shift (a partial unique index
      // on swap_requests(shift_id) WHERE status='pending' backs this up at
      // the database level; see the SwapRequest model's doc comment).
      const flipped = await tx.shift.updateMany({
        where: { id: params.shiftId, status: 'claimed', version: shift.version },
        data: { status: 'pending_swap', version: { increment: 1 } },
      });
      if (flipped.count === 0) {
        throw new HttpError(409, 'This shift is no longer available to request.');
      }

      const swapRequest = await tx.swapRequest.create({
        data: {
          teamId: params.teamId,
          shiftId: params.shiftId,
          requestingUserId: currentUser.id,
          currentHolderId: holderId,
          expiresAt,
        },
      });

      const scheduledTask = await recordScheduledTask(tx, {
        teamId: params.teamId,
        type: 'swap_expiry',
        payload: { swapRequestId: swapRequest.id },
        runAt: expiresAt,
      });

      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'swap_requested',
        targetEntity: 'swap_request',
        targetId: swapRequest.id,
        afterState: { status: 'pending', shiftId: params.shiftId, currentHolderId: holderId },
      });

      const outboxEvent = await recordOutboxEvent(tx, {
        teamId: params.teamId,
        eventType: 'swap_requested',
        category: 'swaps',
        recipientScope: { type: 'team_broadcast' },
        actorId: currentUser.id,
        payload: {
          swapRequestId: swapRequest.id,
          shiftId: params.shiftId,
          sessionId: shift.sessionId,
          pointId: shift.pointId,
          pointName: shift.point.name,
          direction: shift.direction,
          requestingUserId: currentUser.id,
          requestingUserName: currentUser.name,
          currentHolderId: holderId,
        },
      });

      return {
        swapRequestId: swapRequest.id,
        outboxEventId: outboxEvent.id,
        scheduledTaskId: scheduledTask.id,
      };
    });

    enqueueOutboxEventBestEffort(app.outboxQueue, created.outboxEventId);
    void enqueueScheduledTask(app.scheduledTaskQueue, created.scheduledTaskId, expiresAt).catch(
      () => {
        // Same best-effort reasoning as enqueueOutboxEventBestEffort: the
        // worker's own startup reconciliation picks up any row still
        // missing a terminal timestamp, so a dropped enqueue here just
        // means the expiry fires a little late after a worker restart, not
        // never.
      },
    );

    const result = await loadSwapRequestWithRelations(app.prisma, created.swapRequestId);
    return swapRequestSchema.parse(toSwapRequestDto(result!));
  });

  app.post('/teams/:teamId/swap-requests/:swapRequestId/accept', async (request) => {
    const params = swapRequestParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const existing = await loadSwapRequestWithRelations(app.prisma, params.swapRequestId);
    if (!existing || existing.teamId !== params.teamId) {
      throw new HttpError(404, 'Swap request not found.');
    }
    if (existing.currentHolderId !== currentUser.id) {
      throw new HttpError(403, 'Only the current shift holder can accept this swap request.');
    }
    if (existing.status !== 'pending' || existing.expiresAt.getTime() <= Date.now()) {
      throw new HttpError(409, 'This swap request is no longer pending.');
    }

    const accepted = await app.prisma.$transaction(async (tx) => {
      // The acceptance CAS: reassigns the shift only if it's still exactly
      // where the swap request left it (pending_swap, same holder, same
      // version) — a stale request (the shift changed underneath it some
      // other way) fails cleanly instead of silently reassigning a shift
      // that's no longer what the requester thinks they're taking over.
      const shiftUpdated = await tx.shift.updateMany({
        where: {
          id: existing.shiftId,
          status: 'pending_swap',
          assignedUserId: existing.currentHolderId,
          version: existing.shift.version,
        },
        data: {
          status: 'claimed',
          assignedUserId: existing.requestingUserId,
          version: { increment: 1 },
        },
      });
      if (shiftUpdated.count === 0) {
        throw new HttpError(409, 'This shift is no longer available to accept.');
      }

      const requestUpdated = await tx.swapRequest.updateMany({
        where: { id: existing.id, status: 'pending' },
        data: { status: 'accepted' },
      });
      if (requestUpdated.count === 0) {
        throw new HttpError(409, 'This swap request is no longer pending.');
      }

      await cancelPendingExpiryTask(tx, existing.id);

      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'swap_accepted',
        targetEntity: 'swap_request',
        targetId: existing.id,
        beforeState: { status: 'pending' },
        afterState: { status: 'accepted' },
      });

      const outboxEvent = await recordOutboxEvent(tx, {
        teamId: params.teamId,
        eventType: 'swap_accepted',
        category: 'swaps',
        recipientScope: { type: 'team_broadcast' },
        actorId: currentUser.id,
        payload: {
          swapRequestId: existing.id,
          shiftId: existing.shiftId,
          sessionId: existing.shift.sessionId,
          pointId: existing.shift.pointId,
          pointName: existing.shift.point.name,
          direction: existing.shift.direction,
          requestingUserId: existing.requestingUserId,
          requestingUserName: existing.requestingUser.name,
          currentHolderId: existing.currentHolderId,
          currentHolderName: existing.currentHolder.name,
        },
      });

      // Accept is the only swap outcome that actually reassigns the shift
      // (decline/cancel/expire all revert to the same original holder) —
      // the only one that needs the reminder schedule re-derived: the old
      // holder's pending reminders cancelled, the new holder's created.
      const reminders = await syncShiftReminders(tx, existing.shiftId);

      return { outboxEventId: outboxEvent.id, reminders };
    });

    enqueueOutboxEventBestEffort(app.outboxQueue, accepted.outboxEventId);
    enqueueScheduledTaskBestEffort(app.scheduledTaskQueue, accepted.reminders);

    const updated = await loadSwapRequestWithRelations(app.prisma, params.swapRequestId);
    return swapRequestSchema.parse(toSwapRequestDto(updated!));
  });

  app.post('/teams/:teamId/swap-requests/:swapRequestId/decline', async (request) => {
    const params = swapRequestParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const existing = await loadSwapRequestWithRelations(app.prisma, params.swapRequestId);
    if (!existing || existing.teamId !== params.teamId) {
      throw new HttpError(404, 'Swap request not found.');
    }
    if (existing.currentHolderId !== currentUser.id) {
      throw new HttpError(403, 'Only the current shift holder can decline this swap request.');
    }
    if (existing.status !== 'pending') {
      throw new HttpError(409, 'This swap request is no longer pending.');
    }

    const outboxEventId = await app.prisma.$transaction((tx) =>
      resolveSwapRequestOutcome(tx, existing, 'declined', currentUser.id),
    );

    enqueueOutboxEventBestEffort(app.outboxQueue, outboxEventId);

    const updated = await loadSwapRequestWithRelations(app.prisma, params.swapRequestId);
    return swapRequestSchema.parse(toSwapRequestDto(updated!));
  });

  app.post('/teams/:teamId/swap-requests/:swapRequestId/cancel', async (request) => {
    const params = swapRequestParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const existing = await loadSwapRequestWithRelations(app.prisma, params.swapRequestId);
    if (!existing || existing.teamId !== params.teamId) {
      throw new HttpError(404, 'Swap request not found.');
    }
    if (existing.requestingUserId !== currentUser.id) {
      throw new HttpError(403, 'Only the requester can cancel this swap request.');
    }
    if (existing.status !== 'pending') {
      throw new HttpError(409, 'This swap request is no longer pending.');
    }

    const outboxEventId = await app.prisma.$transaction((tx) =>
      resolveSwapRequestOutcome(tx, existing, 'cancelled', currentUser.id),
    );

    enqueueOutboxEventBestEffort(app.outboxQueue, outboxEventId);

    const updated = await loadSwapRequestWithRelations(app.prisma, params.swapRequestId);
    return swapRequestSchema.parse(toSwapRequestDto(updated!));
  });
}
