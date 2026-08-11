import {
  acceptInviteRequestSchema,
  acceptInviteResponseSchema,
  authSessionResponseSchema,
  createInviteRequestSchema,
  invitePreviewSchema,
  inviteSummarySchema,
  passkeyChallengeResponseSchema,
  passkeyVerifyRequestSchema,
} from '@soccer/contracts';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../env';
import { recordAuditLog } from '../lib/audit';
import { requireAuth, requireTeamRole } from '../lib/authorization';
import { setSessionCookies } from '../lib/cookies';
import { generateInviteCode, generateSessionToken, hashSecret } from '../lib/crypto';
import { HttpError } from '../lib/errors';
import {
  createRegistrationChallenge,
  verifyRegistrationChallenge,
} from '../lib/passkey-registration';

const codeParamsSchema = z.object({ code: z.string().min(1) });

/**
 * How long after an invite is accepted its code can still be used to register
 * a passkey. Without a bound, capturing an already-used invite code would let
 * someone attach a new credential to that account indefinitely — the invite
 * is meant to authorize one onboarding sitting, not standing account access.
 */
const PASSKEY_REGISTRATION_WINDOW_MINUTES = 15;

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
    const params = codeParamsSchema.parse(request.params);
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
    const params = codeParamsSchema.parse(request.params);
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
      // Guarded on the invite's own status first (not the user lookup below) so
      // a double-accept race is resolved here: only the winner proceeds to
      // touch the User table, so two concurrent requests can never both try to
      // create a user with the same phone/email.
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

      await tx.invite.update({
        where: { id: invite.id },
        data: { acceptedByUserId: user.id },
      });

      const existingMembership = await tx.teamMember.findUnique({
        where: { teamId_userId: { teamId: invite.teamId, userId: user.id } },
      });

      // Recovery path: this invite was generated for someone already on the
      // team — e.g. an admin re-inviting a user whose device/passkey was lost,
      // per the recovery model in CLAUDE.md §9.1. Don't create a duplicate
      // membership or duplicate players; just re-anchor the invite to this
      // user (done above) so the passkey-registration step below can issue
      // them a fresh credential. A hard 409 here would make that recovery
      // path — an admin's only lever for a locked-out user — permanently
      // unreachable.
      const players = existingMembership
        ? await tx.player.findMany({
            where: { teamId: invite.teamId, parents: { some: { userId: user.id } } },
          })
        : await Promise.all(
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

      if (!existingMembership) {
        await tx.teamMember.create({
          data: { teamId: invite.teamId, userId: user.id, role: 'parent' },
        });
      }

      const team = await tx.team.findUniqueOrThrow({ where: { id: invite.teamId } });

      await recordAuditLog(tx, {
        teamId: invite.teamId,
        actorId: user.id,
        actionType: existingMembership ? 'invite_accepted_for_recovery' : 'invite_accepted',
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

  app.post('/invites/:code/passkey/register/options', async (request, reply) => {
    const params = codeParamsSchema.parse(request.params);
    const invite = await loadAcceptedInvite(app, params.code);

    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: invite.acceptedByUserId! },
      include: { passkeys: true },
    });

    const { challengeId, options } = await createRegistrationChallenge(
      app.prisma,
      app.webauthnVerifier,
      user,
      request.ip,
    );

    reply.status(201);
    return passkeyChallengeResponseSchema.parse({ challengeId, options });
  });

  app.post('/invites/:code/passkey/register/verify', async (request, reply) => {
    const params = codeParamsSchema.parse(request.params);
    const body = passkeyVerifyRequestSchema.parse(request.body);
    const invite = await loadAcceptedInvite(app, params.code);

    await verifyRegistrationChallenge(app.prisma, app.webauthnVerifier, {
      challengeId: body.challengeId,
      expectedUserId: invite.acceptedByUserId!,
      response: body.response as RegistrationResponseJSON,
    });

    // Registration alone doesn't grant a session (unlike the authenticated
    // `/auth/passkey/register/*` pair) — this is a brand-new parent's first
    // credential, so it also needs to establish their first session.
    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: invite.acceptedByUserId! },
      include: { teamMemberships: { include: { team: true } } },
    });

    const token = generateSessionToken();
    const sessionExpiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await app.prisma.session.create({
      data: { userId: user.id, tokenHash: hashSecret(token), expiresAt: sessionExpiresAt },
    });

    setSessionCookies(reply, token, sessionExpiresAt);

    return authSessionResponseSchema.parse({
      sessionToken: token,
      expiresAt: sessionExpiresAt.toISOString(),
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        languagePreference: user.languagePreference,
      },
      teamMemberships: user.teamMemberships.map((membership) => ({
        teamId: membership.teamId,
        teamName: membership.team.name,
        role: membership.role,
        timezone: membership.team.timezone,
      })),
    });
  });
}

async function loadAcceptedInvite(app: FastifyInstance, code: string) {
  const invite = await app.prisma.invite.findUnique({ where: { code } });
  if (!invite || invite.status !== 'accepted' || !invite.acceptedByUserId || !invite.acceptedAt) {
    throw new HttpError(404, 'Invite not found or not yet accepted.');
  }
  const windowMs = PASSKEY_REGISTRATION_WINDOW_MINUTES * 60 * 1000;
  if (Date.now() - invite.acceptedAt.getTime() > windowMs) {
    throw new HttpError(
      409,
      'This invite link can no longer be used to set up a passkey. Ask your team admin for a new one.',
    );
  }
  return invite;
}
