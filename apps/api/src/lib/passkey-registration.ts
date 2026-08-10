import type {
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { PrismaClient } from '../../generated/prisma/client';
import { env } from '../env';
import { HttpError } from './errors';
import type { WebauthnVerifier } from './webauthn';

/**
 * Shared by the two "register a passkey" entry points — `auth.ts` (for an
 * already-authenticated user) and `invites.ts` (invite-code-scoped, for a
 * brand-new parent with no session yet). The steps are identical; only how
 * the caller resolves and authorizes the target user differs.
 */
export async function createRegistrationChallenge(
  prisma: PrismaClient,
  webauthnVerifier: WebauthnVerifier,
  user: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    passkeys: { credentialId: string; transports: string[] }[];
  },
  requestIp?: string,
) {
  const options = await webauthnVerifier.generateRegistrationOptions({
    rpID: env.WEBAUTHN_RP_ID,
    rpName: env.WEBAUTHN_RP_NAME,
    userId: user.id,
    userName: user.phone ?? user.email ?? user.id,
    userDisplayName: user.name,
    excludeCredentials: user.passkeys.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports as AuthenticatorTransportFuture[],
    })),
  });

  // Opportunistic cleanup — there's no job scheduler in this codebase yet
  // (Stage 4's territory), so expired challenges are pruned lazily on the
  // same request path that creates new ones, bounding table growth without
  // new infrastructure.
  await prisma.webauthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  const challenge = await prisma.webauthnChallenge.create({
    data: {
      userId: user.id,
      type: 'registration',
      challenge: options.challenge,
      requestIp,
      expiresAt: new Date(Date.now() + env.WEBAUTHN_CHALLENGE_TTL_MINUTES * 60 * 1000),
    },
  });

  return { challengeId: challenge.id, options };
}

export async function verifyRegistrationChallenge(
  prisma: PrismaClient,
  webauthnVerifier: WebauthnVerifier,
  params: { challengeId: string; expectedUserId: string; response: RegistrationResponseJSON },
): Promise<void> {
  const challenge = await prisma.webauthnChallenge.findUnique({
    where: { id: params.challengeId },
  });

  if (
    !challenge ||
    challenge.type !== 'registration' ||
    challenge.userId !== params.expectedUserId ||
    challenge.consumedAt !== null ||
    challenge.expiresAt.getTime() < Date.now()
  ) {
    throw new HttpError(401, 'Invalid or expired registration attempt. Please try again.');
  }

  const result = await webauthnVerifier.verifyRegistration({
    response: params.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: env.WEB_ORIGIN,
    expectedRPID: env.WEBAUTHN_RP_ID,
  });

  if (!result.verified || !result.registrationInfo) {
    throw new HttpError(401, 'Passkey registration failed.');
  }

  const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;

  await prisma.$transaction([
    prisma.webauthnChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    }),
    prisma.passkey.create({
      data: {
        userId: challenge.userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      },
    }),
  ]);
}
