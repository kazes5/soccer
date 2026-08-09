import {
  acceptInviteRequestSchema,
  acceptInviteResponseSchema,
  createInviteRequestSchema,
  invitePreviewSchema,
  inviteSummarySchema,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAuditLog } from '../lib/audit';
import { requireAuth, requireTeamRole } from '../lib/authorization';
import { generateInviteCode } from '../lib/crypto';
import { HttpError } from '../lib/errors';

export default async function inviteRoutes(app: FastifyInstance) {
  app.post('/teams/:teamId/invites', async (request, reply) => {
    const params = z.object({ teamId: z.string().uuid() }).parse(request.params);
    const body = createInviteRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);

    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);

    const invite = await app.prisma.$transaction(async (tx) => {
      const created = await tx.invite.create({
        data: {
          teamId: params.teamId,
          code: generateInviteCode(),
          phone: body.phone,
          email: body.email,
          createdByUserId: currentUser.id,
          expiresAt: new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000),
        },
      });

      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'invite_created',
        targetEntity: 'invite',
        targetId: created.id,
        afterState: { phone: created.phone, email: created.email, expiresAt: created.expiresAt },
      });

      return created;
    });

    reply.status(201);
    return inviteSummarySchema.parse({
      id: invite.id,
      teamId: invite.teamId,
      code: invite.code,
      phone: invite.phone,
      email: invite.email,
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
    });
  });

  app.get('/invites/:code', async (request) => {
    const params = z.object({ code: z.string().min(1) }).parse(request.params);
    const invite = await app.prisma.invite.findUnique({
      where: { code: params.code },
      include: { team: true },
    });

    if (!invite) {
      throw new HttpError(404, 'Invite not found.');
    }

    return invitePreviewSchema.parse({
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
      team: { id: invite.team.id, name: invite.team.name },
    });
  });

  app.post('/invites/:code/accept', async (request, reply) => {
    const params = z.object({ code: z.string().min(1) }).parse(request.params);
    const body = acceptInviteRequestSchema.parse(request.body);

    const invite = await app.prisma.invite.findUnique({ where: { code: params.code } });
    if (!invite) {
      throw new HttpError(404, 'Invite not found.');
    }
    if (invite.status !== 'pending') {
      throw new HttpError(409, 'This invite is no longer valid.');
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      await app.prisma.invite.updateMany({
        where: { id: invite.id, status: 'pending' },
        data: { status: 'expired' },
      });
      throw new HttpError(409, 'This invite has expired.');
    }

    const contactWhere = invite.phone ? { phone: invite.phone } : { email: invite.email as string };

    const result = await app.prisma.$transaction(async (tx) => {
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, status: 'pending' },
        data: { status: 'accepted', acceptedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new HttpError(409, 'This invite is no longer valid.');
      }

      let user = await tx.user.findFirst({ where: contactWhere });
      if (!user) {
        user = await tx.user.create({
          data: {
            name: body.name,
            phone: invite.phone,
            email: invite.email,
            languagePreference: body.language,
          },
        });
      }

      const existingMembership = await tx.teamMember.findUnique({
        where: { teamId_userId: { teamId: invite.teamId, userId: user.id } },
      });
      if (existingMembership) {
        throw new HttpError(409, "You're already on this team.");
      }

      await tx.teamMember.create({
        data: { teamId: invite.teamId, userId: user.id, role: 'parent' },
      });

      const players = await Promise.all(
        body.players.map((player) =>
          tx.player.create({
            data: {
              teamId: invite.teamId,
              name: player.name,
              age: player.age,
              parents: { create: { userId: user.id, relationship: 'parent' } },
            },
          }),
        ),
      );

      const team = await tx.team.findUniqueOrThrow({ where: { id: invite.teamId } });

      await recordAuditLog(tx, {
        teamId: invite.teamId,
        actorId: user.id,
        actionType: 'invite_accepted',
        targetEntity: 'invite',
        targetId: invite.id,
        afterState: { userId: user.id, playerCount: players.length },
      });

      return { user, team, players };
    });

    reply.status(201);
    return acceptInviteResponseSchema.parse({
      user: {
        id: result.user.id,
        name: result.user.name,
        phone: result.user.phone,
        email: result.user.email,
        languagePreference: result.user.languagePreference,
      },
      team: {
        id: result.team.id,
        name: result.team.name,
        season: result.team.season,
        timezone: result.team.timezone,
      },
      players: result.players.map((player) => ({
        id: player.id,
        name: player.name,
        age: player.age,
      })),
    });
  });
}
