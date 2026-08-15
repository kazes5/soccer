import {
  acceptInviteRequestSchema,
  acceptInviteResponseSchema,
  authSessionResponseSchema,
  createInviteRequestSchema,
  invitePreviewSchema,
  inviteSummarySchema,
  passkeyChallengeResponseSchema,
  passkeyVerifyRequestSchema,
  verifyInviteCodeRequestSchema,
  verifyInviteCodeResponseSchema,
  completePasswordOnboardingRequestSchema,
  attachExistingAccountInviteRequestSchema,
} from '@soccer/contracts';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../env';
import { recordAuditLog } from '../lib/audit';
import { requireAuth, requirePrivilegedAssurance, requireTeamRole } from '../lib/authorization';
import { setSessionCookies } from '../lib/cookies';
import {
  generateInviteCode,
  generateOnboardingCode,
  generateSessionToken,
  hashSecret,
} from '../lib/crypto';
import { HttpError } from '../lib/errors';
import { normalizeEmail, normalizePhone } from '../lib/identifiers';
import { assertAcceptablePassword, hashPassword } from '../lib/passwords';
import { recordOutboxEvent } from '../lib/outbox';
import {
  PASSKEY_REGISTRATION_WINDOW_MINUTES,
  createRegistrationChallenge,
  verifyRegistrationChallenge,
} from '../lib/passkey-registration';
import { enqueueOutboxEventBestEffort } from '../lib/queues';

const codeParamsSchema = z.object({ code: z.string().min(1) });

export default async function inviteRoutes(app: FastifyInstance) {
  app.post('/teams/:teamId/invites', async (request, reply) => {
    const params = z.object({ teamId: z.string().uuid() }).parse(request.params);
    const body = createInviteRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);

    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);
    requirePrivilegedAssurance(currentUser);

    const code = generateInviteCode();
    const invite = await app.prisma.$transaction(async (tx) => {
      const created = await tx.invite.create({
        data: {
          teamId: params.teamId,
          code,
          codeVersion: 1,
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
      code,
      phone: invite.phone,
      email: invite.email,
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
    });
  });

  // Version 2 invitations intentionally live beside the legacy passkey route.
  // Existing links can therefore finish their original flow while all current
  // first-party clients use the split link-token + numeric-code onboarding.
  app.post('/teams/:teamId/password-invites', async (request, reply) => {
    if (!app.passwordAuthEnabled) throw new HttpError(404, 'Not found.');
    const params = z.object({ teamId: z.string().uuid() }).parse(request.params);
    const body = createInviteRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);

    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);
    requirePrivilegedAssurance(currentUser);

    const linkToken = generateInviteCode();
    const onboardingCode = generateOnboardingCode();
    const invite = await app.prisma.$transaction(async (tx) => {
      const created = await tx.invite.create({
        data: {
          teamId: params.teamId,
          code: hashSecret(linkToken),
          codeVersion: 2,
          onboardingCodeHash: hashSecret(`${linkToken}:${onboardingCode}`),
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
      code: linkToken,
      onboardingCode,
      phone: invite.phone,
      email: invite.email,
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
    });
  });

  app.get('/invites/:code', async (request) => {
    const params = codeParamsSchema.parse(request.params);
    const invite = await findInviteByToken(app, params.code);

    if (!invite) {
      throw new HttpError(404, 'Invite not found.');
    }

    return invitePreviewSchema.parse({
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
      team: { id: invite.team.id, name: invite.team.name },
      requiresCode: invite.codeVersion >= 2,
    });
  });

  app.post('/invites/:code/verify-code', async (request) => {
    if (!app.passwordAuthEnabled) throw new HttpError(404, 'Not found.');
    const params = codeParamsSchema.parse(request.params);
    const body = verifyInviteCodeRequestSchema.parse(request.body);
    const result = await app.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ locked: number }>>`
        SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtextextended(${`invite-ip:${request.ip}`}, 0))
      `;
      await tx.$queryRaw<Array<{ locked: number }>>`
        SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtextextended(${`invite-token:${hashSecret(params.code)}`}, 0))
      `;
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const ipBucket = `invite:${request.ip}`;
      const ipFailures = await tx.passwordLoginAttempt.count({
        where: { requestIp: ipBucket, succeeded: false, createdAt: { gte: oneHourAgo } },
      });
      if (ipFailures >= env.INVITE_CODE_MAX_FAILURES_PER_IP_PER_HOUR)
        return { kind: 'limited' as const };
      const invite = await tx.invite.findFirst({
        where: { code: hashSecret(params.code), codeVersion: 2 },
        include: { team: true },
      });
      const invalid =
        !invite || invite.status !== 'pending' || invite.expiresAt.getTime() < Date.now();
      const incorrect =
        !invite?.onboardingCodeHash ||
        hashSecret(`${params.code}:${body.code}`) !== invite.onboardingCodeHash;
      if (invalid || incorrect) {
        if (invite && invite.failedCodeAttempts < 10) {
          await tx.invite.update({
            where: { id: invite.id },
            data: { failedCodeAttempts: { increment: 1 }, lastFailedCodeAt: new Date() },
          });
        }
        await tx.passwordLoginAttempt.create({
          data: {
            identifierHash: hashSecret(`invite:${params.code}`),
            requestIp: ipBucket,
            succeeded: false,
          },
        });
        return {
          kind:
            invite && invite.failedCodeAttempts >= 9 ? ('limited' as const) : ('invalid' as const),
        };
      }
      if (invite.failedCodeAttempts >= 10) return { kind: 'limited' as const };
      const verificationToken = generateSessionToken();
      await tx.invite.update({
        where: { id: invite.id },
        data: {
          verificationTokenHash: hashSecret(verificationToken),
          verificationExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          failedCodeAttempts: 0,
        },
      });
      const contactWhere = invite.phone
        ? { normalizedPhone: normalizePhone(invite.phone) }
        : { normalizedEmail: normalizeEmail(invite.email!) };
      // Only an active account should route into "attach existing account" —
      // login (and thus attaching) is impossible for a deactivated user, so a
      // re-invited removed parent must go through password onboarding
      // instead, which reactivates their account (see complete-password-onboarding).
      const existingAccount = Boolean(
        await tx.user.findFirst({ where: { ...contactWhere, isActive: true } }),
      );
      return { kind: 'ok' as const, verificationToken, existingAccount };
    });
    if (result.kind === 'limited')
      throw new HttpError(
        429,
        'Too many incorrect code attempts. Ask your team admin for a new invite.',
      );
    if (result.kind === 'invalid')
      throw new HttpError(400, 'This invitation or code is invalid or expired.');
    return verifyInviteCodeResponseSchema.parse(result);
  });

  app.post('/invites/:code/complete-password-onboarding', async (request, reply) => {
    if (!app.passwordAuthEnabled) throw new HttpError(404, 'Not found.');
    const params = codeParamsSchema.parse(request.params);
    const body = completePasswordOnboardingRequestSchema.parse(request.body);
    const invite = await findInviteByToken(app, params.code);
    if (
      !invite ||
      invite.status !== 'pending' ||
      !invite.verificationTokenHash ||
      hashSecret(body.verificationToken) !== invite.verificationTokenHash ||
      !invite.verificationExpiresAt ||
      invite.verificationExpiresAt.getTime() < Date.now()
    ) {
      throw new HttpError(400, 'Invitation verification is invalid or expired.');
    }
    const contactWhere = invite.phone
      ? { normalizedPhone: normalizePhone(invite.phone) }
      : { normalizedEmail: normalizeEmail(invite.email!) };
    // Only an *active* account blocks onboarding here. A deactivated
    // (removed) parent re-invited to the same contact info must not dead-end
    // on "log in to attach" — login itself requires isActive:true, so that
    // account could never be reached. Below, a matching inactive row is
    // reactivated instead of blocking or creating a colliding duplicate
    // (phone/email/normalized columns are all globally unique).
    if (await app.prisma.user.findFirst({ where: { ...contactWhere, isActive: true } })) {
      throw new HttpError(409, 'This account already exists. Log in to join this team.');
    }
    const password = assertAcceptablePassword(body.password, [
      invite.phone ?? '',
      invite.email ?? '',
    ]);
    const passwordHash = await hashPassword(password);
    const sessionToken = generateSessionToken();
    const sessionExpiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const result = await app.prisma.$transaction(async (tx) => {
      const claimed = await tx.invite.updateMany({
        where: {
          id: invite.id,
          status: 'pending',
          verificationTokenHash: hashSecret(body.verificationToken),
        },
        data: {
          status: 'accepted',
          acceptedAt: new Date(),
          verificationTokenHash: null,
          verificationExpiresAt: null,
        },
      });
      if (claimed.count !== 1) throw new HttpError(409, 'This invite is no longer valid.');

      const existing = await tx.user.findFirst({ where: contactWhere });
      if (existing?.isActive) {
        // Raced with another request that reactivated/created this contact
        // between the pre-check above and this transaction.
        throw new HttpError(409, 'This account already exists. Log in to join this team.');
      }
      const reactivating = existing !== null;
      const user = reactivating
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              name: body.name,
              languagePreference: body.language,
              isActive: true,
              passwordCredential: {
                upsert: { create: { passwordHash }, update: { passwordHash } },
              },
              sessions: {
                create: {
                  tokenHash: hashSecret(sessionToken),
                  expiresAt: sessionExpiresAt,
                  authMethod: 'password',
                },
              },
            },
          })
        : await tx.user.create({
            data: {
              name: body.name,
              phone: invite.phone,
              email: invite.email,
              normalizedPhone: invite.phone ? normalizePhone(invite.phone) : undefined,
              normalizedEmail: invite.email ? normalizeEmail(invite.email) : undefined,
              languagePreference: body.language,
              passwordCredential: { create: { passwordHash } },
              sessions: {
                create: {
                  tokenHash: hashSecret(sessionToken),
                  expiresAt: sessionExpiresAt,
                  authMethod: 'password',
                },
              },
            },
          });
      // A reactivated user's prior membership on this exact team was deleted
      // on removal (see members.ts), so this is always a fresh row either way.
      await tx.teamMember.create({
        data: { teamId: invite.teamId, userId: user.id, role: 'parent' },
      });
      await tx.invite.update({ where: { id: invite.id }, data: { acceptedByUserId: user.id } });
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
        actionType: reactivating ? 'invite_accepted_for_recovery' : 'invite_accepted',
        targetEntity: 'invite',
        targetId: invite.id,
        afterState: { userId: user.id, playerCount: players.length, authMethod: 'password' },
      });
      const event = await recordOutboxEvent(tx, {
        teamId: invite.teamId,
        eventType: 'invite_accepted',
        category: 'admin_changes',
        recipientScope: { type: 'team_broadcast' },
        payload: { userId: user.id, userName: user.name },
      });
      return { user, team, eventId: event.id };
    });
    enqueueOutboxEventBestEffort(app.outboxQueue, result.eventId);
    setSessionCookies(reply, sessionToken, sessionExpiresAt);
    reply.status(201);
    return authSessionResponseSchema.parse({
      sessionToken,
      expiresAt: sessionExpiresAt.toISOString(),
      user: {
        id: result.user.id,
        name: result.user.name,
        phone: result.user.phone,
        email: result.user.email,
        languagePreference: result.user.languagePreference,
      },
      teamMemberships: [
        {
          teamId: result.team.id,
          teamName: result.team.name,
          role: 'parent',
          timezone: result.team.timezone,
        },
      ],
      systemRole: null,
      authMethod: 'password',
    });
  });

  app.post('/invites/:code/attach-account', async (request, reply) => {
    if (!app.passwordAuthEnabled) throw new HttpError(404, 'Not found.');
    const params = codeParamsSchema.parse(request.params);
    const body = attachExistingAccountInviteRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);
    const invite = await findInviteByToken(app, params.code);
    if (
      !invite ||
      invite.status !== 'pending' ||
      !invite.verificationTokenHash ||
      hashSecret(body.verificationToken) !== invite.verificationTokenHash ||
      !invite.verificationExpiresAt ||
      invite.verificationExpiresAt.getTime() < Date.now()
    ) {
      throw new HttpError(400, 'Invitation verification is invalid or expired.');
    }
    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: currentUser.id } });
    const matches = invite.phone
      ? user.normalizedPhone === normalizePhone(invite.phone)
      : user.normalizedEmail === normalizeEmail(invite.email!);
    if (!matches) throw new HttpError(403, 'This invitation belongs to a different account.');

    const result = await app.prisma.$transaction(async (tx) => {
      const claimed = await tx.invite.updateMany({
        where: {
          id: invite.id,
          status: 'pending',
          verificationTokenHash: hashSecret(body.verificationToken),
        },
        data: {
          status: 'accepted',
          acceptedAt: new Date(),
          acceptedByUserId: user.id,
          verificationTokenHash: null,
          verificationExpiresAt: null,
        },
      });
      if (claimed.count !== 1) throw new HttpError(409, 'This invite is no longer valid.');
      await tx.teamMember.upsert({
        where: { teamId_userId: { teamId: invite.teamId, userId: user.id } },
        create: { teamId: invite.teamId, userId: user.id, role: 'parent' },
        update: {},
      });
      await recordAuditLog(tx, {
        teamId: invite.teamId,
        actorId: user.id,
        actionType: 'invite_accepted',
        targetEntity: 'invite',
        targetId: invite.id,
        afterState: { userId: user.id, existingAccount: true },
      });
      const event = await recordOutboxEvent(tx, {
        teamId: invite.teamId,
        eventType: 'invite_accepted',
        category: 'admin_changes',
        recipientScope: { type: 'team_broadcast' },
        payload: { userId: user.id, userName: user.name },
      });
      return event.id;
    });
    enqueueOutboxEventBestEffort(app.outboxQueue, result);
    reply.status(204).send();
  });

  app.post('/invites/:code/accept', async (request, reply) => {
    const params = codeParamsSchema.parse(request.params);
    const body = acceptInviteRequestSchema.parse(request.body);

    const invite = await findInviteByToken(app, params.code);
    if (!invite) {
      throw new HttpError(404, 'Invite not found.');
    }
    if (invite.codeVersion !== 1) {
      throw new HttpError(400, 'Enter the separate invitation code to continue.');
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
            normalizedPhone: invite.phone ? normalizePhone(invite.phone) : undefined,
            normalizedEmail: invite.email ? normalizeEmail(invite.email) : undefined,
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

      // Only a genuinely new membership is "user added to team" per CLAUDE.md
      // §3.5 — the recovery path (re-issuing a passkey to an already-existing
      // member) doesn't change team composition, so it isn't notification-worthy.
      let outboxEventId: string | undefined;
      if (!existingMembership) {
        const outboxEvent = await recordOutboxEvent(tx, {
          teamId: invite.teamId,
          eventType: 'invite_accepted',
          category: 'admin_changes',
          recipientScope: { type: 'team_broadcast' },
          payload: { userId: user.id, userName: user.name },
        });
        outboxEventId = outboxEvent.id;
      }

      return { user, team, players, outboxEventId };
    });

    if (result.outboxEventId) {
      enqueueOutboxEventBestEffort(app.outboxQueue, result.outboxEventId);
    }

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
      data: {
        userId: user.id,
        tokenHash: hashSecret(token),
        expiresAt: sessionExpiresAt,
        authMethod: 'passkey',
      },
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
      systemRole: user.systemRole,
      authMethod: 'passkey',
    });
  });
}

async function loadAcceptedInvite(app: FastifyInstance, code: string) {
  const invite = await findInviteByToken(app, code);
  if (
    !invite ||
    invite.codeVersion !== 1 ||
    invite.status !== 'accepted' ||
    !invite.acceptedByUserId ||
    !invite.acceptedAt
  ) {
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

async function findInviteByToken(app: FastifyInstance, token: string) {
  const hashed = hashSecret(token);
  return app.prisma.invite.findFirst({
    where: {
      OR: [
        { code: hashed, codeVersion: 2 },
        { code: token, codeVersion: 1 },
      ],
    },
    include: { team: true },
  });
}
