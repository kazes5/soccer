import {
  practiceSessionSchema,
  sessionListResponseSchema,
  updateSessionPointPlayersRequestSchema,
  updateSessionRequestSchema,
  type PracticeSession,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAuditLog } from '../lib/audit';
import { requireAuth, requireTeamRole } from '../lib/authorization';
import { HttpError } from '../lib/errors';
import { recordOutboxEvent } from '../lib/outbox';
import { enqueueOutboxEventBestEffort } from '../lib/queues';
import { instantToWallClock, localDateTimeToInstant } from '../lib/timezone';

const teamParamsSchema = z.object({ teamId: z.string().uuid() });
const sessionParamsSchema = z.object({ teamId: z.string().uuid(), sessionId: z.string().uuid() });
const sessionPointParamsSchema = z.object({
  teamId: z.string().uuid(),
  sessionId: z.string().uuid(),
  pointId: z.string().uuid(),
});
const listQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

type SessionWithRelations = Awaited<ReturnType<typeof loadSession>>;

/** A session becomes a read-only historical record once its start time has passed —
 * whether or not anything ever flipped its status to `completed` (nothing does yet;
 * see PLAN.md's Stage 3 note). Reused by every mutating session endpoint below. */
function assertSessionNotPast(startsAt: Date, message: string) {
  if (startsAt.getTime() <= Date.now()) {
    throw new HttpError(409, message);
  }
}

async function loadSession(prisma: FastifyInstance['prisma'], sessionId: string) {
  return prisma.practiceSession.findUnique({
    where: { id: sessionId },
    include: {
      assignments: { include: { point: true } },
      shifts: { include: { assignedUser: true } },
    },
  });
}

function toSessionDto(session: NonNullable<SessionWithRelations>): PracticeSession {
  return {
    id: session.id,
    teamId: session.teamId,
    templateId: session.templateId,
    startsAt: session.startsAt.toISOString(),
    fieldLocation: session.fieldLocation,
    status: session.status,
    points: session.assignments.map((assignment) => {
      const shift = session.shifts.find(
        (candidate) =>
          candidate.pointId === assignment.pointId && candidate.direction === assignment.direction,
      );
      if (!shift) {
        throw new Error(
          `Missing shift for session ${session.id} point ${assignment.pointId} direction ${assignment.direction}.`,
        );
      }
      return {
        pointId: assignment.pointId,
        pointName: assignment.point.name,
        direction: assignment.direction,
        playerIds: assignment.playerIds,
        shift: {
          id: shift.id,
          sessionId: shift.sessionId,
          pointId: shift.pointId,
          direction: shift.direction,
          status: shift.status,
          assignedUserId: shift.assignedUserId,
          assignedUserName: shift.assignedUser?.name ?? null,
          version: shift.version,
        },
      };
    }),
  };
}

export default async function sessionRoutes(app: FastifyInstance) {
  app.get('/teams/:teamId/sessions', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const query = listQuerySchema.parse(request.query);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const sessions = await app.prisma.practiceSession.findMany({
      where: {
        teamId: params.teamId,
        ...(query.from || query.to
          ? {
              startsAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      include: {
        assignments: { include: { point: true } },
        shifts: { include: { assignedUser: true } },
      },
      orderBy: { startsAt: 'asc' },
    });

    return sessionListResponseSchema.parse({ sessions: sessions.map(toSessionDto) });
  });

  app.patch('/teams/:teamId/sessions/:sessionId', async (request) => {
    const params = sessionParamsSchema.parse(request.params);
    const body = updateSessionRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);

    const existing = await loadSession(app.prisma, params.sessionId);
    if (!existing || existing.teamId !== params.teamId) {
      throw new HttpError(404, 'Session not found.');
    }
    if (existing.status !== 'scheduled') {
      throw new HttpError(409, 'Only a scheduled, upcoming session can be edited.');
    }
    assertSessionNotPast(
      existing.startsAt,
      'This session has already happened and can no longer be edited.',
    );

    const session = await app.prisma.$transaction(async (tx) => {
      // `date`/`time` are independently optional local wall-clock values (see
      // the contract schema's doc comment) — whichever one isn't provided falls
      // back to the session's current value, recovered through the team's own
      // timezone rather than read off the stored UTC instant directly. Re-read
      // immediately before the write (inside this transaction, not from the
      // `existing` snapshot taken before it) so two concurrent partial edits
      // (one sending only `time`, the other only `date`) can't silently clobber
      // each other with a stale default for the field they didn't send.
      let newStartsAt: Date | undefined;
      if (body.date !== undefined || body.time !== undefined) {
        const [team, freshSession] = await Promise.all([
          tx.team.findUniqueOrThrow({ where: { id: params.teamId }, select: { timezone: true } }),
          tx.practiceSession.findUniqueOrThrow({
            where: { id: params.sessionId },
            select: { startsAt: true },
          }),
        ]);
        const current = instantToWallClock(freshSession.startsAt, team.timezone);
        newStartsAt = localDateTimeToInstant(
          body.date ?? current.date,
          body.time ?? current.time,
          team.timezone,
        );
      }

      const updated = await tx.practiceSession.update({
        where: { id: params.sessionId },
        data: {
          startsAt: newStartsAt,
          fieldLocation: body.fieldLocation,
        },
        include: {
          assignments: { include: { point: true } },
          shifts: { include: { assignedUser: true } },
        },
      });

      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'session_updated',
        targetEntity: 'practice_session',
        targetId: updated.id,
        beforeState: { startsAt: existing.startsAt, fieldLocation: existing.fieldLocation },
        afterState: { startsAt: updated.startsAt, fieldLocation: updated.fieldLocation },
      });

      const outboxEvent = await recordOutboxEvent(tx, {
        teamId: params.teamId,
        eventType: 'session_updated',
        category: 'shift_changes',
        recipientScope: { type: 'team_broadcast' },
        payload: {
          sessionId: updated.id,
          startsAt: updated.startsAt.toISOString(),
          fieldLocation: updated.fieldLocation,
        },
      });

      return { updated, outboxEventId: outboxEvent.id };
    });

    enqueueOutboxEventBestEffort(app.outboxQueue, session.outboxEventId);

    return practiceSessionSchema.parse(toSessionDto(session.updated));
  });

  app.post('/teams/:teamId/sessions/:sessionId/cancel', async (request) => {
    const params = sessionParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);

    const existing = await loadSession(app.prisma, params.sessionId);
    if (!existing || existing.teamId !== params.teamId) {
      throw new HttpError(404, 'Session not found.');
    }
    if (existing.status === 'cancelled') {
      throw new HttpError(409, 'This session is already cancelled.');
    }
    assertSessionNotPast(
      existing.startsAt,
      'This session has already happened and can no longer be cancelled.',
    );

    const session = await app.prisma.$transaction(async (tx) => {
      const updated = await tx.practiceSession.update({
        where: { id: params.sessionId },
        data: { status: 'cancelled' },
        include: {
          assignments: { include: { point: true } },
          shifts: { include: { assignedUser: true } },
        },
      });

      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'session_cancelled',
        targetEntity: 'practice_session',
        targetId: updated.id,
        beforeState: { status: existing.status },
        afterState: { status: updated.status },
      });

      const outboxEvent = await recordOutboxEvent(tx, {
        teamId: params.teamId,
        eventType: 'session_cancelled',
        category: 'shift_changes',
        recipientScope: { type: 'team_broadcast' },
        payload: {
          sessionId: updated.id,
          startsAt: updated.startsAt.toISOString(),
          fieldLocation: updated.fieldLocation,
        },
      });

      return { updated, outboxEventId: outboxEvent.id };
    });

    enqueueOutboxEventBestEffort(app.outboxQueue, session.outboxEventId);

    return practiceSessionSchema.parse(toSessionDto(session.updated));
  });

  app.patch('/teams/:teamId/sessions/:sessionId/points/:pointId', async (request) => {
    const params = sessionPointParamsSchema.parse(request.params);
    const body = updateSessionPointPlayersRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);

    const assignment = await app.prisma.sessionPointAssignment.findUnique({
      where: {
        sessionId_pointId_direction: {
          sessionId: params.sessionId,
          pointId: params.pointId,
          direction: body.direction,
        },
      },
      include: { session: true, point: true },
    });
    if (!assignment || assignment.session.teamId !== params.teamId) {
      throw new HttpError(404, 'Session collection-point assignment not found.');
    }
    if (assignment.session.status !== 'scheduled') {
      throw new HttpError(
        409,
        "Only a scheduled, upcoming session's player assignments can be changed.",
      );
    }
    assertSessionNotPast(
      assignment.session.startsAt,
      'This session has already happened and its player assignments can no longer be changed.',
    );

    if (body.playerIds.length > 0) {
      const validPlayerCount = await app.prisma.player.count({
        where: { id: { in: body.playerIds }, teamId: params.teamId },
      });
      if (validPlayerCount !== body.playerIds.length) {
        throw new HttpError(400, 'One or more players were not found on this team.');
      }
    }

    const session = await app.prisma.$transaction(async (tx) => {
      await tx.sessionPointAssignment.update({
        where: { id: assignment.id },
        data: { playerIds: body.playerIds },
      });

      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'session_point_players_updated',
        targetEntity: 'session_point_assignment',
        targetId: assignment.id,
        beforeState: { playerIds: assignment.playerIds },
        afterState: { playerIds: body.playerIds },
      });

      const outboxEvent = await recordOutboxEvent(tx, {
        teamId: params.teamId,
        eventType: 'session_point_players_updated',
        category: 'shift_changes',
        recipientScope: { type: 'team_broadcast' },
        payload: {
          sessionId: params.sessionId,
          pointId: params.pointId,
          pointName: assignment.point.name,
          direction: body.direction,
        },
      });

      const updated = await tx.practiceSession.findUniqueOrThrow({
        where: { id: params.sessionId },
        include: {
          assignments: { include: { point: true } },
          shifts: { include: { assignedUser: true } },
        },
      });
      return { updated, outboxEventId: outboxEvent.id };
    });

    enqueueOutboxEventBestEffort(app.outboxQueue, session.outboxEventId);

    return practiceSessionSchema.parse(toSessionDto(session.updated));
  });
}
