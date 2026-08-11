import { shiftStatsResponseSchema, shiftSummarySchema } from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAuditLog } from '../lib/audit';
import { requireAuth, requireTeamRole } from '../lib/authorization';
import { HttpError } from '../lib/errors';
import { recordOutboxEvent } from '../lib/outbox';
import { enqueueOutboxEventBestEffort } from '../lib/queues';

const teamParamsSchema = z.object({ teamId: z.string().uuid() });
const shiftParamsSchema = z.object({ teamId: z.string().uuid(), shiftId: z.string().uuid() });

function toDto(shift: {
  id: string;
  sessionId: string;
  pointId: string;
  direction: 'to_practice' | 'from_practice';
  status: 'open' | 'claimed' | 'pending_swap';
  assignedUserId: string | null;
  assignedUser: { name: string } | null;
  version: number;
}) {
  return {
    id: shift.id,
    sessionId: shift.sessionId,
    pointId: shift.pointId,
    direction: shift.direction,
    status: shift.status,
    assignedUserId: shift.assignedUserId,
    assignedUserName: shift.assignedUser?.name ?? null,
    version: shift.version,
  };
}

export default async function shiftRoutes(app: FastifyInstance) {
  // Any team member (not admin-only) — CLAUDE.md's Requirement 13 keeps
  // individual member stats admin-only but lets every parent see the team
  // average for self-comparison, computed here so the caller never needs the
  // roster itself.
  app.get('/teams/:teamId/shifts/stats', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const notCancelled = {
      session: { teamId: params.teamId, status: { not: 'cancelled' as const } },
    };

    const [myToPractice, myFromPractice, teamToPractice, teamFromPractice, teamMemberCount] =
      await Promise.all([
        app.prisma.shift.count({
          where: { ...notCancelled, assignedUserId: currentUser.id, direction: 'to_practice' },
        }),
        app.prisma.shift.count({
          where: { ...notCancelled, assignedUserId: currentUser.id, direction: 'from_practice' },
        }),
        app.prisma.shift.count({
          where: { ...notCancelled, assignedUserId: { not: null }, direction: 'to_practice' },
        }),
        app.prisma.shift.count({
          where: { ...notCancelled, assignedUserId: { not: null }, direction: 'from_practice' },
        }),
        app.prisma.teamMember.count({ where: { teamId: params.teamId } }),
      ]);

    const average = (count: number) => (teamMemberCount > 0 ? count / teamMemberCount : 0);

    return shiftStatsResponseSchema.parse({
      mine: {
        toPractice: myToPractice,
        fromPractice: myFromPractice,
        total: myToPractice + myFromPractice,
      },
      teamAverage: {
        toPractice: average(teamToPractice),
        fromPractice: average(teamFromPractice),
        total: average(teamToPractice + teamFromPractice),
      },
    });
  });

  app.post('/teams/:teamId/shifts/:shiftId/claim', async (request) => {
    const params = shiftParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const shift = await app.prisma.shift.findUnique({
      where: { id: params.shiftId },
      include: { session: true },
    });
    if (!shift || shift.session.teamId !== params.teamId) {
      throw new HttpError(404, 'Shift not found.');
    }
    if (shift.session.status !== 'scheduled') {
      throw new HttpError(409, 'This session is no longer scheduled.');
    }

    const updated = await app.prisma.$transaction(async (tx) => {
      // Predicated on both status and the expected version (not status alone) —
      // the compare-and-set the architecture calls for, guarding against a
      // release-then-reclaim ABA cycle between the read above and this update.
      const claimed = await tx.shift.updateMany({
        where: { id: params.shiftId, status: 'open', version: shift.version },
        data: { status: 'claimed', assignedUserId: currentUser.id, version: { increment: 1 } },
      });

      if (claimed.count === 0) {
        const current = await tx.shift.findUniqueOrThrow({
          where: { id: params.shiftId },
          include: { assignedUser: true },
        });
        throw new HttpError(409, 'That shift was just claimed by someone else.', {
          holderName: current.assignedUser?.name ?? null,
        });
      }

      const result = await tx.shift.findUniqueOrThrow({
        where: { id: params.shiftId },
        include: { assignedUser: true, point: true },
      });

      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'shift_claimed',
        targetEntity: 'shift',
        targetId: result.id,
        // The predicate above guarantees `shift.version` was still current at
        // the moment this update matched — safe to log as the true "before".
        beforeState: { status: 'open', version: shift.version },
        afterState: {
          status: result.status,
          assignedUserId: result.assignedUserId,
          version: result.version,
        },
      });

      const outboxEvent = await recordOutboxEvent(tx, {
        teamId: params.teamId,
        eventType: 'shift_claimed',
        category: 'shift_changes',
        recipientScope: { type: 'team_broadcast' },
        payload: {
          sessionId: result.sessionId,
          shiftId: result.id,
          pointId: result.pointId,
          pointName: result.point.name,
          direction: result.direction,
          sessionStartsAt: shift.session.startsAt.toISOString(),
          byUserName: currentUser.name,
        },
      });

      return { result, outboxEventId: outboxEvent.id };
    });

    enqueueOutboxEventBestEffort(app.outboxQueue, updated.outboxEventId);

    return shiftSummarySchema.parse(toDto(updated.result));
  });

  app.post('/teams/:teamId/shifts/:shiftId/release', async (request) => {
    const params = shiftParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const shift = await app.prisma.shift.findUnique({
      where: { id: params.shiftId },
      include: { session: true },
    });
    if (!shift || shift.session.teamId !== params.teamId) {
      throw new HttpError(404, 'Shift not found.');
    }
    if (shift.session.status !== 'scheduled') {
      throw new HttpError(409, 'This session is no longer scheduled.');
    }

    const updated = await app.prisma.$transaction(async (tx) => {
      const released = await tx.shift.updateMany({
        where: {
          id: params.shiftId,
          status: 'claimed',
          assignedUserId: currentUser.id,
          version: shift.version,
        },
        data: { status: 'open', assignedUserId: null, version: { increment: 1 } },
      });

      if (released.count === 0) {
        throw new HttpError(409, 'This shift is no longer assigned to you.');
      }

      const result = await tx.shift.findUniqueOrThrow({
        where: { id: params.shiftId },
        include: { assignedUser: true, point: true },
      });

      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'shift_released',
        targetEntity: 'shift',
        targetId: result.id,
        beforeState: { status: 'claimed', assignedUserId: currentUser.id, version: shift.version },
        afterState: { status: result.status, version: result.version },
      });

      const outboxEvent = await recordOutboxEvent(tx, {
        teamId: params.teamId,
        eventType: 'shift_released',
        category: 'shift_changes',
        recipientScope: { type: 'team_broadcast' },
        payload: {
          sessionId: result.sessionId,
          shiftId: result.id,
          pointId: result.pointId,
          pointName: result.point.name,
          direction: result.direction,
          sessionStartsAt: shift.session.startsAt.toISOString(),
          byUserName: currentUser.name,
          reason: 'voluntary',
        },
      });

      return { result, outboxEventId: outboxEvent.id };
    });

    enqueueOutboxEventBestEffort(app.outboxQueue, updated.outboxEventId);

    return shiftSummarySchema.parse(toDto(updated.result));
  });
}
