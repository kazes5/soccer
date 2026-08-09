import { createInviteRequestSchema, inviteSummarySchema } from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAuditLog } from '../lib/audit';
import { requireAuth, requireTeamRole } from '../lib/authorization';
import { generateInviteCode } from '../lib/crypto';

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
}
