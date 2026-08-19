import {
  authSessionResponseSchema,
  currentUserResponseSchema,
  passwordChangeRequestSchema,
  passwordLoginRequestSchema,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
  type TeamAccentColor,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { env } from '../env';
import { requireAuth } from '../lib/authorization';
import {
  clearSessionCookies,
  CSRF_COOKIE_NAME,
  resolveSessionToken,
  setSessionCookies,
} from '../lib/cookies';
import { generateSessionToken, hashSecret } from '../lib/crypto';
import { HttpError } from '../lib/errors';
import { normalizeLoginIdentifier } from '../lib/identifiers';
import {
  assertAcceptablePassword,
  hashPassword,
  verifyDummyPassword,
  verifyPassword,
} from '../lib/passwords';
import { recordSystemAuditLog } from '../lib/system-audit';

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/password/login', async (request, reply) => {
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
      },
    });
    const csrfToken = setSessionCookies(reply, token, sessionExpiresAt);
    return authSessionResponseSchema.parse({
      sessionToken: token,
      expiresAt: sessionExpiresAt.toISOString(),
      user: toUserSummary(user),
      teamMemberships: toMemberships(user.teamMemberships),
      systemRole: app.systemAdminEnabled ? user.systemRole : null,
      csrfToken,
    });
  });

  app.post('/auth/password/change', async (request, reply) => {
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
    const body = forgotPasswordRequestSchema.parse(request.body);
    const normalized = normalizeLoginIdentifier(body.identifier);
    // Every response here looks identical regardless of whether the account
    // exists (enumeration resistance — see below), so unlike login there's no
    // "failure" to count. This instead bounds request *volume* instead, since
    // an unthrottled endpoint could otherwise be used to spam a victim's
    // email/SMS or exhaust the recovery provider's send quota. A distinct
    // `password-reset:` prefix on both bucket keys keeps this counter from
    // mixing with login's own per-account/per-IP failure counters, which
    // share the same table.
    const identifierHash = hashSecret(
      `password-reset:${normalized.normalizedEmail ?? normalized.normalizedPhone ?? body.identifier}`,
    );
    const requestIpBucket = `password-reset:${request.ip}`;
    const { user, limited } = await app.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ locked: number }>>`
        SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtextextended(${`password-reset-ip:${request.ip}`}, 0))
      `;
      await tx.$queryRaw<Array<{ locked: number }>>`
        SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtextextended(${`password-reset-account:${identifierHash}`}, 0))
      `;
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const [accountRequests, ipRequests] = await Promise.all([
        tx.passwordLoginAttempt.count({
          where: { identifierHash, createdAt: { gte: oneHourAgo } },
        }),
        tx.passwordLoginAttempt.count({
          where: { requestIp: requestIpBucket, createdAt: { gte: oneHourAgo } },
        }),
      ]);
      if (
        accountRequests >= env.PASSWORD_RESET_MAX_REQUESTS_PER_ACCOUNT_PER_HOUR ||
        ipRequests >= env.PASSWORD_RESET_MAX_REQUESTS_PER_IP_PER_HOUR
      ) {
        return { user: null, limited: true };
      }
      const matchedUser = await tx.user.findFirst({
        where: { isActive: true, ...normalized },
        include: { passwordCredential: true },
      });
      await tx.passwordLoginAttempt.create({
        data: {
          userId: matchedUser?.id,
          identifierHash,
          requestIp: requestIpBucket,
          succeeded: true,
        },
      });
      return { user: matchedUser, limited: false };
    });
    if (limited) {
      throw new HttpError(429, 'Too many recovery requests. Try again later.');
    }
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
        primaryColor: membership.team.primaryColor,
      })),
      systemRole: app.systemAdminEnabled ? user.systemRole : null,
      csrfToken: request.cookies[CSRF_COOKIE_NAME],
    });
  });
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
    team: {
      name: string;
      timezone: string;
      primaryColor: TeamAccentColor | null;
    };
  }>,
) {
  return memberships.map((membership) => ({
    teamId: membership.teamId,
    teamName: membership.team.name,
    role: membership.role,
    timezone: membership.team.timezone,
    primaryColor: membership.team.primaryColor,
  }));
}
