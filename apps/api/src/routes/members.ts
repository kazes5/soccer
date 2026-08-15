import {
  teamMemberListResponseSchema,
  teamRosterResponseSchema,
  updateMemberRoleRequestSchema,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAuditLog } from '../lib/audit';
import { requireAuth, requirePrivilegedAssurance, requireTeamRole } from '../lib/authorization';
import { HttpError } from '../lib/errors';
import { recordOutboxEvent } from '../lib/outbox';
import { enqueueOutboxEventBestEffort, enqueueScheduledTaskBestEffort } from '../lib/queues';
import { syncShiftReminders } from '../lib/reminders';
import { resolveSwapRequestOutcome, swapRequestInclude } from '../lib/swap-requests';

const paramsSchema = z.object({ teamId: z.string().uuid() });
const memberParamsSchema = z.object({ teamId: z.string().uuid(), userId: z.string().uuid() });

export default async function memberRoutes(app: FastifyInstance) {
  app.get('/teams/:teamId/members', async (request) => {
    const params = paramsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);
    requirePrivilegedAssurance(currentUser);

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
    requirePrivilegedAssurance(currentUser);

    const updated = await app.prisma.$transaction(async (tx) => {
      // Serialize every role/removal mutation for this team. Without this row
      // lock, two admins could concurrently demote each other after both saw
      // "one other admin", leaving the team with none.
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "teams" WHERE "id" = ${params.teamId} FOR UPDATE
      `;

      // Authorization is checked again after acquiring the lock so an admin
      // concurrently demoted by the preceding transaction cannot still use a
      // stale pre-lock authorization decision.
      const actingMembership = await tx.teamMember.findUnique({
        where: { teamId_userId: { teamId: params.teamId, userId: currentUser.id } },
        select: { role: true },
      });
      if (actingMembership?.role !== 'admin') {
        throw new HttpError(403, 'Admin access is required for this team.');
      }

      const target = await tx.teamMember.findUnique({
        where: { teamId_userId: { teamId: params.teamId, userId: params.userId } },
        include: { user: { select: { name: true, systemRole: true } } },
      });
      if (!target) {
        throw new HttpError(404, 'This person is not on the team.');
      }
      if (target.role === body.role) {
        return { changed: target, outboxEventId: null };
      }

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

    if (updated.outboxEventId) {
      enqueueOutboxEventBestEffort(app.outboxQueue, updated.outboxEventId);
    }

    return { userId: updated.changed.userId, role: updated.changed.role };
  });

  app.delete('/teams/:teamId/members/:userId', async (request, reply) => {
    const params = memberParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);
    requirePrivilegedAssurance(currentUser);

    const result = await app.prisma.$transaction(async (tx) => {
      const eventIds: string[] = [];
      const reminders: { id: string; runAt: Date }[] = [];

      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "teams" WHERE "id" = ${params.teamId} FOR UPDATE
      `;

      const actingMembership = await tx.teamMember.findUnique({
        where: { teamId_userId: { teamId: params.teamId, userId: currentUser.id } },
        select: { role: true },
      });
      if (actingMembership?.role !== 'admin') {
        throw new HttpError(403, 'Admin access is required for this team.');
      }

      const target = await tx.teamMember.findUnique({
        where: { teamId_userId: { teamId: params.teamId, userId: params.userId } },
        include: { user: { select: { name: true, systemRole: true } } },
      });
      if (!target) {
        throw new HttpError(404, 'This person is not on the team.');
      }

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

      // Any open swaps involving them (as requester or holder) are
      // cancelled, per CLAUDE.md §4.2 — resolved *before* the held-shift
      // release below, since a shift with a pending swap sits in
      // `pending_swap`, not `claimed`, and only reverts to `claimed` once
      // its swap is resolved; the release query right after this one only
      // matches `claimed` shifts.
      const pendingSwaps = await tx.swapRequest.findMany({
        where: {
          teamId: params.teamId,
          status: 'pending',
          OR: [{ requestingUserId: params.userId }, { currentHolderId: params.userId }],
        },
        include: swapRequestInclude,
      });
      for (const pendingSwap of pendingSwaps) {
        const swapOutboxEventId = await resolveSwapRequestOutcome(
          tx,
          pendingSwap,
          'cancelled',
          currentUser.id,
        );
        eventIds.push(swapOutboxEventId);
      }

      // Any shifts they held on this team are returned to open, per CLAUDE.md
      // §4.2 — otherwise a removed user's login is revoked and the shift can
      // never be claimed or released by anyone else again.
      const heldShifts = await tx.shift.findMany({
        where: {
          assignedUserId: params.userId,
          status: 'claimed',
          session: {
            teamId: params.teamId,
            status: 'scheduled',
            startsAt: { gt: new Date() },
          },
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
        // Cancel-only in practice (the shift now has no assignee), but goes
        // through the same shared sync every other assignment change uses.
        reminders.push(...(await syncShiftReminders(tx, heldShift.id)));
      }

      const remainingMemberships = await tx.teamMember.count({
        where: { userId: params.userId },
      });
      // A system admin's login/account access is governed by their global
      // role, not team membership (CLAUDE.md §9.3: system_admin is "never a
      // team role"; PLAN.md's system console explicitly supports "a system
      // admin with no team membership"). Deactivating them here just because
      // their last team membership ended would strand a legitimate,
      // team-independent system admin out of `/system/*` too.
      if (remainingMemberships === 0 && target.user.systemRole === null) {
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

      return { eventIds, reminders };
    });

    for (const outboxEventId of result.eventIds) {
      enqueueOutboxEventBestEffort(app.outboxQueue, outboxEventId);
    }
    enqueueScheduledTaskBestEffort(app.scheduledTaskQueue, result.reminders);

    reply.status(204).send();
  });
}
