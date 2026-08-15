import {
  authSessionResponseSchema,
  currentUserResponseSchema,
  passkeyChallengeResponseSchema,
  passkeyLoginOptionsRequestSchema,
  passkeyVerifyRequestSchema,
  passwordChangeRequestSchema,
  passwordLoginRequestSchema,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
} from '@soccer/contracts';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server';
import type { FastifyInstance } from 'fastify';
import { env } from '../env';
import { requireAuth, requirePrivilegedAssurance } from '../lib/authorization';
import { clearSessionCookies, resolveSessionToken, setSessionCookies } from '../lib/cookies';
import { generateSessionToken, hashSecret } from '../lib/crypto';
import { HttpError } from '../lib/errors';
import { normalizeLoginIdentifier } from '../lib/identifiers';
import {
  assertAcceptablePassword,
  hashPassword,
  verifyDummyPassword,
  verifyPassword,
} from '../lib/passwords';
import {
  createRegistrationChallenge,
  verifyRegistrationChallenge,
} from '../lib/passkey-registration';
import { recordSystemAuditLog } from '../lib/system-audit';

const NOT_REGISTERED_MESSAGE =
  "You haven't been added to a team yet. Ask your team admin for an invite.";
const INVALID_CHALLENGE_MESSAGE = 'Invalid or expired login attempt. Please try again.';

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/password/login', async (request, reply) => {
    requirePasswordAuth(app);
    const body = passwordLoginRequestSchema.parse(request.body);
    const normalized = normalizeLoginIdentifier(body.identifier);
    const identifierHash = hashSecret(
      normalized.normalizedEmail ?? normalized.normalizedPhone ?? body.identifier,
    );
    const requestIpBucket = `password:${request.ip}`;
    const login = await app.prisma.$transaction(async (tx) => {
      // Serialize each account and IP bucket so a parallel burst cannot have
      // every request observe the same pre-increment count.
      await tx.$queryRaw<Array<{ locked: number }>>`
        SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtextextended(${`password-ip:${request.ip}`}, 0))
      `;
      await tx.$queryRaw<Array<{ locked: number }>>`
        SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtextextended(${`password-account:${identifierHash}`}, 0))
      `;
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const [accountFailures, ipFailures] = await Promise.all([
        tx.passwordLoginAttempt.count({
          where: { identifierHash, succeeded: false, createdAt: { gte: oneHourAgo } },
        }),
        tx.passwordLoginAttempt.count({
          where: { requestIp: requestIpBucket, succeeded: false, createdAt: { gte: oneHourAgo } },
        }),
      ]);
      if (
        accountFailures >= env.PASSWORD_LOGIN_MAX_FAILURES_PER_ACCOUNT_PER_HOUR ||
        ipFailures >= env.PASSWORD_LOGIN_MAX_FAILURES_PER_IP_PER_HOUR
      ) {
        throw new HttpError(429, 'Too many login attempts. Try again later.');
      }
      const user = await tx.user.findFirst({
        where: { isActive: true, ...normalized },
        include: {
          passwordCredential: true,
          teamMemberships: { include: { team: true } },
        },
      });
      const valid = user?.passwordCredential
        ? await verifyPassword(user.passwordCredential.passwordHash, body.password)
        : await verifyDummyPassword(body.password);
      await tx.passwordLoginAttempt.create({
        data: {
          userId: user?.id,
          identifierHash,
          requestIp: requestIpBucket,
          succeeded: Boolean(valid),
        },
      });
      return { user, valid };
    });
    if (!login.user || !login.valid) {
      throw new HttpError(401, 'Invalid username or password.');
    }
    const user = login.user;

    const token = generateSessionToken();
    const sessionExpiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await app.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashSecret(token),
        expiresAt: sessionExpiresAt,
        authMethod: 'password',
      },
    });
    setSessionCookies(reply, token, sessionExpiresAt);
    return authSessionResponseSchema.parse({
      sessionToken: token,
      expiresAt: sessionExpiresAt.toISOString(),
      user: toUserSummary(user),
      teamMemberships: toMemberships(user.teamMemberships),
      systemRole: app.systemAdminEnabled ? user.systemRole : null,
      authMethod: 'password',
    });
  });

  app.post('/auth/password/change', async (request, reply) => {
    requirePasswordAuth(app);
    const currentUser = requireAuth(request);
    const body = passwordChangeRequestSchema.parse(request.body);
    const credential = await app.prisma.passwordCredential.findUnique({
      where: { userId: currentUser.id },
      include: { user: true },
    });
    if (!credential || !(await verifyPassword(credential.passwordHash, body.currentPassword))) {
      throw new HttpError(401, 'Current password is incorrect.');
    }
    const password = assertAcceptablePassword(body.password, [
      credential.user.email ?? '',
      credential.user.phone ?? '',
    ]);
    const passwordHash = await hashPassword(password);
    await app.prisma.$transaction(async (tx) => {
      const changed = await tx.passwordCredential.updateMany({
        where: { userId: currentUser.id, passwordHash: credential.passwordHash },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      if (changed.count !== 1) {
        throw new HttpError(409, 'The password changed in another session. Try again.');
      }
      await tx.session.updateMany({
        where: { userId: currentUser.id, id: { not: currentUser.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await recordSystemAuditLog(tx, {
        actorId: currentUser.id,
        actionType: 'password_changed',
        targetEntity: 'user',
        targetId: currentUser.id,
      });
    });
    reply.status(204).send();
  });

  app.post('/auth/password/forgot', async (request, reply) => {
    requirePasswordAuth(app);
    const body = forgotPasswordRequestSchema.parse(request.body);
    const normalized = normalizeLoginIdentifier(body.identifier);
    const user = await app.prisma.user.findFirst({
      where: { isActive: true, ...normalized },
      include: { passwordCredential: true },
    });
    if (user?.passwordCredential && app.passwordRecoveryProvider.isConfigured) {
      const token = generateSessionToken();
      await app.prisma.$transaction(async (tx) => {
        await tx.passwordResetToken.updateMany({
          where: { userId: user.id, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        await tx.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashSecret(token),
            expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
          },
        });
      });
      await app.passwordRecoveryProvider.sendReset({
        phone: user.phone,
        email: user.email,
        // A fragment stays client-side and out of HTTP request/access logs.
        resetUrl: `${env.WEB_ORIGIN}/reset-password#token=${encodeURIComponent(token)}`,
      });
    }
    reply.status(202).send({ message: 'If the account exists, recovery instructions were sent.' });
  });

  app.post('/auth/password/reset', async (request, reply) => {
    requirePasswordAuth(app);
    const body = resetPasswordRequestSchema.parse(request.body);
    const reset = await app.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashSecret(body.token) },
      include: { user: true },
    });
    if (!reset || reset.consumedAt || reset.expiresAt.getTime() < Date.now()) {
      throw new HttpError(400, 'This password reset link is invalid or expired.');
    }
    const password = assertAcceptablePassword(body.password, [
      reset.user.email ?? '',
      reset.user.phone ?? '',
    ]);
    const passwordHash = await hashPassword(password);
    await app.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: reset.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) throw new HttpError(400, 'This password reset link is invalid.');
      await tx.passwordCredential.upsert({
        where: { userId: reset.userId },
        create: { userId: reset.userId, passwordHash },
        update: { passwordHash, passwordChangedAt: new Date() },
      });
      await tx.session.updateMany({
        where: { userId: reset.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await recordSystemAuditLog(tx, {
        actorId: reset.userId,
        actionType: 'password_reset',
        targetEntity: 'user',
        targetId: reset.userId,
      });
    });
    clearSessionCookies(reply);
    reply.status(204).send();
  });
  // Register a passkey for the *currently authenticated* user — covers a
  // fresh admin right after `POST /teams` (which issues a session directly,
  // with no invite in the picture), a password-only user's first, privileged
  // passkey (e.g. after being promoted to team-admin — see requirePrivilegedAssurance),
  // and any already-passkey-authenticated user adding a second device later.
  // A password/bootstrap session may only register when it has zero passkeys
  // (its one self-service first-credential path); once it has one, further
  // registrations require passkey-authenticated assurance, same as any other
  // passkey user. The invite-scoped pair in `invites.ts` is only for a
  // brand-new parent's very first passkey, before any session exists to gate on.
  app.post('/auth/passkey/register/options', async (request, reply) => {
    const currentUser = requireAuth(request);
    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: currentUser.id },
      include: { passkeys: true },
    });
    if (
      (currentUser.authMethod === 'password' || currentUser.authMethod === 'bootstrap') &&
      user.passkeys.length > 0
    ) {
      throw new HttpError(403, 'Verify an existing passkey before adding another passkey.');
    }
    if (currentUser.authMethod === 'passkey') requirePrivilegedAssurance(currentUser);

    const { challengeId, options } = await createRegistrationChallenge(
      app.prisma,
      app.webauthnVerifier,
      user,
      request.ip,
    );

    reply.status(201);
    return passkeyChallengeResponseSchema.parse({ challengeId, options });
  });

  app.post('/auth/passkey/register/verify', async (request, reply) => {
    const currentUser = requireAuth(request);
    if (currentUser.authMethod === 'password' || currentUser.authMethod === 'bootstrap') {
      const existingPasskeyCount = await app.prisma.passkey.count({
        where: { userId: currentUser.id },
      });
      if (existingPasskeyCount > 0) {
        throw new HttpError(403, 'Verify an existing passkey before adding another passkey.');
      }
    }
    if (currentUser.authMethod === 'passkey') requirePrivilegedAssurance(currentUser);
    const body = passkeyVerifyRequestSchema.parse(request.body);

    await verifyRegistrationChallenge(app.prisma, app.webauthnVerifier, {
      challengeId: body.challengeId,
      expectedUserId: currentUser.id,
      response: body.response as RegistrationResponseJSON,
    });

    await app.prisma.session.update({
      where: { id: currentUser.sessionId },
      data: { authMethod: 'passkey', authenticatedAt: new Date() },
    });

    reply.status(204).send();
  });

  app.post('/auth/passkey/login/options', async (request, reply) => {
    const body = passkeyLoginOptionsRequestSchema.parse(request.body);

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentRequestCountForIp = await app.prisma.webauthnChallenge.count({
      where: { requestIp: request.ip, createdAt: { gte: oneHourAgo } },
    });
    if (recentRequestCountForIp >= env.WEBAUTHN_LOGIN_MAX_REQUESTS_PER_IP_PER_HOUR) {
      throw new HttpError(429, 'Too many login attempts from this network. Try again later.');
    }

    const user = await app.prisma.user.findFirst({
      where: {
        isActive: true,
        ...(body.phone
          ? {
              OR: [
                { normalizedPhone: normalizeLoginIdentifier(body.phone).normalizedPhone },
                { phone: body.phone },
              ],
            }
          : {
              OR: [
                { normalizedEmail: normalizeLoginIdentifier(body.email!).normalizedEmail },
                { email: body.email },
              ],
            }),
      },
      include: { passkeys: true },
    });

    // Same generic message whether the contact isn't registered at all or is
    // registered but somehow has no passkey (e.g. onboarding was abandoned
    // before registration completed) — both mean "ask your admin," and using
    // one message avoids a distinct oracle for the latter, rarer case.
    if (!user || user.passkeys.length === 0) {
      reply.status(404);
      return { message: NOT_REGISTERED_MESSAGE };
    }

    const options = await app.webauthnVerifier.generateAuthenticationOptions({
      rpID: env.WEBAUTHN_RP_ID,
      allowCredentials: user.passkeys.map((passkey) => ({
        id: passkey.credentialId,
        transports: passkey.transports as AuthenticatorTransportFuture[],
      })),
    });

    // Opportunistic cleanup — see the same note in lib/passkey-registration.ts.
    await app.prisma.webauthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });

    const challenge = await app.prisma.webauthnChallenge.create({
      data: {
        userId: user.id,
        type: 'authentication',
        challenge: options.challenge,
        requestIp: request.ip,
        expiresAt: new Date(Date.now() + env.WEBAUTHN_CHALLENGE_TTL_MINUTES * 60 * 1000),
      },
    });

    reply.status(201);
    return passkeyChallengeResponseSchema.parse({ challengeId: challenge.id, options });
  });

  app.post('/auth/passkey/login/verify', async (request, reply) => {
    const body = passkeyVerifyRequestSchema.parse(request.body);
    const response = body.response as AuthenticationResponseJSON;

    const challenge = await app.prisma.webauthnChallenge.findUnique({
      where: { id: body.challengeId },
      include: {
        user: { include: { passkeys: true, teamMemberships: { include: { team: true } } } },
      },
    });

    if (
      !challenge ||
      challenge.type !== 'authentication' ||
      challenge.consumedAt !== null ||
      challenge.expiresAt.getTime() < Date.now()
    ) {
      throw new HttpError(401, INVALID_CHALLENGE_MESSAGE);
    }

    const passkey = challenge.user.passkeys.find(
      (candidate) => candidate.credentialId === response.id,
    );
    if (!passkey) {
      throw new HttpError(401, 'This passkey is not recognized.');
    }

    const credential: WebAuthnCredential = {
      id: passkey.credentialId,
      publicKey: new Uint8Array(passkey.publicKey),
      counter: passkey.counter,
      transports: passkey.transports as AuthenticatorTransportFuture[],
    };

    const result = await app.webauthnVerifier.verifyAuthentication({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: env.WEB_ORIGIN,
      expectedRPID: env.WEBAUTHN_RP_ID,
      credential,
    });

    if (!result.verified || !result.authenticationInfo.userVerified) {
      throw new HttpError(401, 'Passkey verification failed.');
    }

    const token = generateSessionToken();
    const sessionExpiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await app.prisma.$transaction(async (tx) => {
      const consumed = await tx.webauthnChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) throw new HttpError(401, INVALID_CHALLENGE_MESSAGE);
      await tx.passkey.update({
        where: { id: passkey.id },
        data: { counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() },
      });
      await tx.session.create({
        data: {
          userId: challenge.userId,
          tokenHash: hashSecret(token),
          expiresAt: sessionExpiresAt,
          authMethod: 'passkey',
        },
      });
    });

    setSessionCookies(reply, token, sessionExpiresAt);

    return authSessionResponseSchema.parse({
      sessionToken: token,
      expiresAt: sessionExpiresAt.toISOString(),
      user: {
        id: challenge.user.id,
        name: challenge.user.name,
        phone: challenge.user.phone,
        email: challenge.user.email,
        languagePreference: challenge.user.languagePreference,
      },
      teamMemberships: challenge.user.teamMemberships.map((membership) => ({
        teamId: membership.teamId,
        teamName: membership.team.name,
        role: membership.role,
        timezone: membership.team.timezone,
      })),
      systemRole: app.systemAdminEnabled ? challenge.user.systemRole : null,
      authMethod: 'passkey',
    });
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = resolveSessionToken(request);
    if (token) {
      await app.prisma.session.updateMany({
        where: { tokenHash: hashSecret(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    clearSessionCookies(reply);
    reply.status(204).send();
  });

  app.get('/auth/me', async (request) => {
    const currentUser = requireAuth(request);
    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: currentUser.id },
      include: { teamMemberships: { include: { team: true } } },
    });

    return currentUserResponseSchema.parse({
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
      systemRole: app.systemAdminEnabled ? user.systemRole : null,
      authMethod: currentUser.authMethod,
    });
  });
}

function requirePasswordAuth(app: FastifyInstance): void {
  if (!app.passwordAuthEnabled) throw new HttpError(404, 'Not found.');
}

function toUserSummary(user: {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  languagePreference: 'en' | 'he';
}) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    languagePreference: user.languagePreference,
  };
}

function toMemberships(
  memberships: Array<{
    teamId: string;
    role: 'parent' | 'admin';
    team: { name: string; timezone: string };
  }>,
) {
  return memberships.map((membership) => ({
    teamId: membership.teamId,
    teamName: membership.team.name,
    role: membership.role,
    timezone: membership.team.timezone,
  }));
}
