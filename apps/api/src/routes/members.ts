import {
  teamMemberListResponseSchema,
  teamRosterResponseSchema,
  updateMemberRoleRequestSchema,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAuditLog } from '../lib/audit';
import { requireAuth, requireTeamRole } from '../lib/authorization';
import { HttpError } from '../lib/errors';
import { recordOutboxEvent } from '../lib/outbox';
import { enqueueOutboxEventBestEffort } from '../lib/queues';

const paramsSchema = z.object({ teamId: z.string().uuid() });
const memberParamsSchema = z.object({ teamId: z.string().uuid(), userId: z.string().uuid() });

export default async function memberRoutes(app: FastifyInstance) {
  app.get('/teams/:teamId/members', async (request) => {
    const params = paramsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);

    const members = await app.prisma.teamMember.findMany({
      where: { teamId: params.teamId },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });

    return teamMemberListResponseSchema.parse({
      members: members.map((member) => ({
        userId: member.userId,
        name: member.user.name,
        phone: member.user.phone,
        email: member.user.email,
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
      })),
    });
  });

  // Parent-readable roster: name + role only, no phone/email — see the
  // schema's own doc comment for why this can't just reuse GET /members.
  app.get('/teams/:teamId/roster', async (request) => {
    const params = paramsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const members = await app.prisma.teamMember.findMany({
      where: { teamId: params.teamId },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: 'asc' } },
    });

    return teamRosterResponseSchema.parse({
      members: members.map((member) => ({
        userId: member.userId,
        name: member.user.name,
        role: member.role,
      })),
    });
  });

  app.patch('/teams/:teamId/members/:userId/role', async (request) => {
    const params = memberParamsSchema.parse(request.params);
    const body = updateMemberRoleRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);

    const target = await app.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: params.teamId, userId: params.userId } },
      include: { user: { select: { name: true } } },
    });
    if (!target) {
      throw new HttpError(404, 'This person is not on the team.');
    }
    if (target.role === body.role) {
      return { userId: target.userId, role: target.role };
    }

    const updated = await app.prisma.$transaction(async (tx) => {
      if (target.role === 'admin' && body.role === 'parent') {
        const otherAdminCount = await tx.teamMember.count({
          where: { teamId: params.teamId, role: 'admin', userId: { not: params.userId } },
        });
        if (otherAdminCount === 0) {
          throw new HttpError(409, 'A team must always have at least one admin.');
        }
      }

      const changed = await tx.teamMember.update({
        where: { teamId_userId: { teamId: params.teamId, userId: params.userId } },
        data: { role: body.role },
      });

      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: body.role === 'admin' ? 'member_promoted' : 'member_demoted',
        targetEntity: 'team_member',
        targetId: params.userId,
        beforeState: { role: target.role },
        afterState: { role: changed.role },
      });

      const outboxEvent = await recordOutboxEvent(tx, {
        teamId: params.teamId,
        eventType: body.role === 'admin' ? 'member_promoted' : 'member_demoted',
        category: 'admin_changes',
        recipientScope: { type: 'team_broadcast' },
        payload: { userId: params.userId, userName: target.user.name },
      });

      return { changed, outboxEventId: outboxEvent.id };
    });

    enqueueOutboxEventBestEffort(app.outboxQueue, updated.outboxEventId);

    return { userId: updated.changed.userId, role: updated.changed.role };
  });

  app.delete('/teams/:teamId/members/:userId', async (request, reply) => {
    const params = memberParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);

    const target = await app.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: params.teamId, userId: params.userId } },
      include: { user: { select: { name: true } } },
    });
    if (!target) {
      throw new HttpError(404, 'This person is not on the team.');
    }

    const outboxEventIds = await app.prisma.$transaction(async (tx) => {
      const eventIds: string[] = [];

      if (target.role === 'admin') {
        const otherAdminCount = await tx.teamMember.count({
          where: { teamId: params.teamId, role: 'admin', userId: { not: params.userId } },
        });
        if (otherAdminCount === 0) {
          throw new HttpError(409, 'A team must always have at least one admin.');
        }
      }

      await tx.teamMember.delete({
        where: { teamId_userId: { teamId: params.teamId, userId: params.userId } },
      });

      // Any shifts they held on this team are returned to open, per CLAUDE.md
      // §4.2 — otherwise a removed user's login is revoked and the shift can
      // never be claimed or released by anyone else again.
      const heldShifts = await tx.shift.findMany({
        where: {
          assignedUserId: params.userId,
          status: 'claimed',
          session: { teamId: params.teamId },
        },
        include: { point: true, session: true },
      });
      for (const heldShift of heldShifts) {
        await tx.shift.updateMany({
          where: { id: heldShift.id, status: 'claimed', version: heldShift.version },
          data: { status: 'open', assignedUserId: null, version: { increment: 1 } },
        });
        await recordAuditLog(tx, {
          teamId: params.teamId,
          actorId: currentUser.id,
          actionType: 'shift_released',
          targetEntity: 'shift',
          targetId: heldShift.id,
          beforeState: {
            status: 'claimed',
            assignedUserId: params.userId,
            version: heldShift.version,
          },
          afterState: { status: 'open' },
        });

        const shiftOutboxEvent = await recordOutboxEvent(tx, {
          teamId: params.teamId,
          eventType: 'shift_released',
          category: 'shift_changes',
          recipientScope: { type: 'team_broadcast' },
          payload: {
            sessionId: heldShift.sessionId,
            shiftId: heldShift.id,
            pointId: heldShift.pointId,
            pointName: heldShift.point.name,
            direction: heldShift.direction,
            sessionStartsAt: heldShift.session.startsAt.toISOString(),
            byUserName: target.user.name,
            reason: 'member_removed',
          },
        });
        eventIds.push(shiftOutboxEvent.id);
      }

      const remainingMemberships = await tx.teamMember.count({
        where: { userId: params.userId },
      });
      if (remainingMemberships === 0) {
        await tx.user.update({ where: { id: params.userId }, data: { isActive: false } });
        await tx.session.updateMany({
          where: { userId: params.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'member_removed',
        targetEntity: 'team_member',
        targetId: params.userId,
        beforeState: { role: target.role },
      });

      const memberOutboxEvent = await recordOutboxEvent(tx, {
        teamId: params.teamId,
        eventType: 'member_removed',
        category: 'admin_changes',
        recipientScope: { type: 'team_broadcast' },
        payload: { userId: params.userId, userName: target.user.name },
      });
      eventIds.push(memberOutboxEvent.id);

      return eventIds;
    });

    for (const outboxEventId of outboxEventIds) {
      enqueueOutboxEventBestEffort(app.outboxQueue, outboxEventId);
    }

    reply.status(204).send();
  });
}
