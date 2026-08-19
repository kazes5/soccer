import { createTeamRequestSchema, createTeamResponseSchema } from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../env';
import { requireAuth, requireTeamRole } from '../lib/authorization';
import { recordAuditLog } from '../lib/audit';
import { setSessionCookies } from '../lib/cookies';
import { generateSessionToken, hashSecret } from '../lib/crypto';
import { normalizeEmail, normalizePhone } from '../lib/identifiers';
import { assertAcceptablePassword, hashPassword } from '../lib/passwords';

export default async function teamRoutes(app: FastifyInstance) {
  app.post('/teams', async (request, reply) => {
    const body = createTeamRequestSchema.parse(request.body);
    const password = assertAcceptablePassword(body.adminPassword, [
      body.adminEmail ?? '',
      body.adminPhone ?? '',
    ]);
    const passwordHash = await hashPassword(password);

    const { team, admin, sessionToken, sessionExpiresAt } = await app.prisma.$transaction(
      async (tx) => {
        const createdTeam = await tx.team.create({
          data: {
            name: body.teamName,
            season: body.season,
            timezone: body.timezone,
          },
        });

        const createdAdmin = await tx.user.create({
          data: {
            name: body.adminName,
            phone: body.adminPhone,
            email: body.adminEmail,
            normalizedPhone: body.adminPhone ? normalizePhone(body.adminPhone) : undefined,
            normalizedEmail: body.adminEmail ? normalizeEmail(body.adminEmail) : undefined,
            languagePreference: body.adminLanguage,
            passwordCredential: { create: { passwordHash } },
            teamMemberships: {
              create: { teamId: createdTeam.id, role: 'admin' },
            },
          },
        });

        await recordAuditLog(tx, {
          teamId: createdTeam.id,
          actorId: createdAdmin.id,
          actionType: 'team_created',
          targetEntity: 'team',
          targetId: createdTeam.id,
          afterState: { name: createdTeam.name, season: createdTeam.season },
        });

        const token = generateSessionToken();
        const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
        await tx.session.create({
          data: {
            userId: createdAdmin.id,
            tokenHash: hashSecret(token),
            expiresAt,
          },
        });

        return {
          team: createdTeam,
          admin: createdAdmin,
          sessionToken: token,
          sessionExpiresAt: expiresAt,
        };
      },
    );

    const csrfToken = setSessionCookies(reply, sessionToken, sessionExpiresAt);

    reply.status(201);
    return createTeamResponseSchema.parse({
      team: {
        id: team.id,
        name: team.name,
        season: team.season,
        timezone: team.timezone,
      },
      admin: {
        id: admin.id,
        name: admin.name,
        phone: admin.phone,
        email: admin.email,
        languagePreference: admin.languagePreference,
      },
      sessionToken,
      sessionExpiresAt: sessionExpiresAt.toISOString(),
      csrfToken,
    });
  });

  app.get('/teams/:teamId', async (request) => {
    const params = z.object({ teamId: z.string().uuid() }).parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const team = await app.prisma.team.findUniqueOrThrow({ where: { id: params.teamId } });
    return {
      id: team.id,
      name: team.name,
      season: team.season,
      timezone: team.timezone,
    };
  });
}
