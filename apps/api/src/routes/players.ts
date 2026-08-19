import {
  createPlayerRequestSchema,
  playerDetailSchema,
  playerListResponseSchema,
  updatePlayerRequestSchema,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAuditLog } from '../lib/audit';
import { requireAuth, requireSystemAdmin, requireTeamRole } from '../lib/authorization';
import { HttpError } from '../lib/errors';

const teamParamsSchema = z.object({ teamId: z.string().uuid() });
const playerParamsSchema = z.object({ teamId: z.string().uuid(), playerId: z.string().uuid() });

/** A team admin manages their own team's roster; a system admin manages any
 *  team's — both are "administrative" here, unlike the read endpoint below,
 *  which any team member (parent or admin) can use. Mirrors system.ts's own
 *  guard() in requiring `systemAdminEnabled` before the system-admin
 *  fallback, so the console's kill-switch also disables this route for a
 *  system admin with no team membership of their own. */
async function requireTeamOrSystemAdmin(
  app: FastifyInstance,
  request: Parameters<typeof requireAuth>[0],
  teamId: string,
) {
  const currentUser = requireAuth(request);
  const membership = await app.prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: currentUser.id } },
  });
  if (membership?.role === 'admin') return currentUser;
  if (!app.systemAdminEnabled) throw new HttpError(403, 'Admin access is required for this team.');
  await requireSystemAdmin(app.prisma, currentUser);
  return currentUser;
}

/** Every parentUserId must already be a member (any role) of this team —
 *  otherwise a caller could link a player to an unrelated team's user,
 *  breaking CLAUDE.md §9.2's per-team data scoping. */
async function assertParentsBelongToTeam(
  app: FastifyInstance,
  teamId: string,
  parentUserIds: string[],
) {
  if (parentUserIds.length === 0) return;
  const memberCount = await app.prisma.teamMember.count({
    where: { teamId, userId: { in: parentUserIds } },
  });
  if (memberCount !== new Set(parentUserIds).size) {
    throw new HttpError(400, 'One or more parents were not found on this team.');
  }
}

export default async function playerRoutes(app: FastifyInstance) {
  app.get('/teams/:teamId/players', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const players = await app.prisma.player.findMany({
      where: { teamId: params.teamId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, age: true },
    });

    return playerListResponseSchema.parse({
      players: players.map((player) => ({ id: player.id, name: player.name, age: player.age })),
    });
  });

  app.post('/teams/:teamId/players', async (request, reply) => {
    const params = teamParamsSchema.parse(request.params);
    await requireTeamOrSystemAdmin(app, request, params.teamId);
    const currentUser = requireAuth(request);
    const body = createPlayerRequestSchema.parse(request.body);
    await assertParentsBelongToTeam(app, params.teamId, body.parentUserIds);

    const player = await app.prisma.$transaction(async (tx) => {
      const created = await tx.player.create({
        data: {
          teamId: params.teamId,
          name: body.name,
          age: body.age,
          parents: { create: body.parentUserIds.map((userId) => ({ userId })) },
        },
        include: { parents: { select: { userId: true } } },
      });
      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'player_created',
        targetEntity: 'player',
        targetId: created.id,
        afterState: { name: created.name, age: created.age },
      });
      return created;
    });

    reply.status(201);
    return playerDetailSchema.parse({
      id: player.id,
      name: player.name,
      age: player.age,
      parentUserIds: player.parents.map((p) => p.userId),
    });
  });

  app.patch('/teams/:teamId/players/:playerId', async (request) => {
    const params = playerParamsSchema.parse(request.params);
    await requireTeamOrSystemAdmin(app, request, params.teamId);
    const currentUser = requireAuth(request);
    const body = updatePlayerRequestSchema.parse(request.body);

    const existing = await app.prisma.player.findFirst({
      where: { id: params.playerId, teamId: params.teamId },
    });
    if (!existing) throw new HttpError(404, 'Player not found.');
    if (body.parentUserIds) {
      await assertParentsBelongToTeam(app, params.teamId, body.parentUserIds);
    }

    const player = await app.prisma.$transaction(async (tx) => {
      if (body.parentUserIds) {
        await tx.playerParent.deleteMany({ where: { playerId: params.playerId } });
      }
      const updated = await tx.player.update({
        where: { id: params.playerId },
        data: {
          name: body.name,
          age: body.age,
          ...(body.parentUserIds
            ? { parents: { create: body.parentUserIds.map((userId) => ({ userId })) } }
            : {}),
        },
        include: { parents: { select: { userId: true } } },
      });
      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'player_updated',
        targetEntity: 'player',
        targetId: updated.id,
        beforeState: { name: existing.name, age: existing.age },
        afterState: { name: updated.name, age: updated.age },
      });
      return updated;
    });

    return playerDetailSchema.parse({
      id: player.id,
      name: player.name,
      age: player.age,
      parentUserIds: player.parents.map((p) => p.userId),
    });
  });

  app.delete('/teams/:teamId/players/:playerId', async (request, reply) => {
    const params = playerParamsSchema.parse(request.params);
    await requireTeamOrSystemAdmin(app, request, params.teamId);
    const currentUser = requireAuth(request);

    const existing = await app.prisma.player.findFirst({
      where: { id: params.playerId, teamId: params.teamId },
    });
    if (!existing) throw new HttpError(404, 'Player not found.');

    await app.prisma.$transaction(async (tx) => {
      await tx.player.delete({ where: { id: params.playerId } });
      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'player_deleted',
        targetEntity: 'player',
        targetId: params.playerId,
        beforeState: { name: existing.name, age: existing.age },
      });
    });

    reply.status(204).send();
  });
}
