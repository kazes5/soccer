import {
  authSessionResponseSchema,
  currentUserResponseSchema,
  passkeyChallengeResponseSchema,
  passkeyLoginOptionsRequestSchema,
  passkeyVerifyRequestSchema,
} from '@soccer/contracts';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server';
import type { FastifyInstance } from 'fastify';
import { env } from '../env';
import { requireAuth } from '../lib/authorization';
import { clearSessionCookies, resolveSessionToken, setSessionCookies } from '../lib/cookies';
import { generateSessionToken, hashSecret } from '../lib/crypto';
import { HttpError } from '../lib/errors';
import {
  createRegistrationChallenge,
  verifyRegistrationChallenge,
} from '../lib/passkey-registration';

const NOT_REGISTERED_MESSAGE =
  "You haven't been added to a team yet. Ask your team admin for an invite.";
const INVALID_CHALLENGE_MESSAGE = 'Invalid or expired login attempt. Please try again.';

export default async function authRoutes(app: FastifyInstance) {
  // Register an additional passkey for the *currently authenticated* user —
  // covers both a fresh admin right after `POST /teams` (which issues a
  // session directly, with no invite in the picture) and any already-logged-in
  // user adding a second device later. The invite-scoped pair in
  // `invites.ts` is only for a brand-new parent's very first passkey, before
  // any session exists to gate on.
  app.post('/auth/passkey/register/options', async (request, reply) => {
    const currentUser = requireAuth(request);
    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: currentUser.id },
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

  app.post('/auth/passkey/register/verify', async (request, reply) => {
    const currentUser = requireAuth(request);
    const body = passkeyVerifyRequestSchema.parse(request.body);

    await verifyRegistrationChallenge(app.prisma, app.webauthnVerifier, {
      challengeId: body.challengeId,
      expectedUserId: currentUser.id,
      response: body.response as RegistrationResponseJSON,
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
        ...(body.phone ? { phone: body.phone } : { email: body.email }),
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

    if (!result.verified) {
      throw new HttpError(401, 'Passkey verification failed.');
    }

    const token = generateSessionToken();
    const sessionExpiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await app.prisma.$transaction([
      app.prisma.webauthnChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      }),
      app.prisma.passkey.update({
        where: { id: passkey.id },
        data: { counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() },
      }),
      app.prisma.session.create({
        data: {
          userId: challenge.userId,
          tokenHash: hashSecret(token),
          expiresAt: sessionExpiresAt,
        },
      }),
    ]);

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
      })),
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
      })),
    });
  });
}
