import {
  requestOtpRequestSchema,
  requestOtpResponseSchema,
  verifyOtpRequestSchema,
  verifyOtpResponseSchema,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { env } from '../env';
import { generateOtpCode, generateSessionToken, hashSecret, secretsMatch } from '../lib/crypto';
import { HttpError } from '../lib/errors';
import type { OtpChannel } from '../lib/otp-provider';

const INVALID_OR_EXPIRED_CODE = 'Invalid or expired code.';

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/otp/request', async (request, reply) => {
    const body = requestOtpRequestSchema.parse(request.body);
    const channel: OtpChannel = body.phone ? 'sms' : 'email';
    const destination = body.phone ?? body.email;
    if (!destination) {
      throw new HttpError(400, 'Provide phone or email.');
    }

    const user = await app.prisma.user.findFirst({
      where: {
        isActive: true,
        ...(body.phone ? { phone: body.phone } : { email: body.email }),
      },
    });

    if (!user) {
      reply.status(404);
      return {
        message: "You haven't been added to a team yet. Ask your team admin for an invite.",
      };
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentRequestCount = await app.prisma.otpChallenge.count({
      where: { userId: user.id, createdAt: { gte: oneHourAgo } },
    });
    if (recentRequestCount >= env.OTP_MAX_REQUESTS_PER_HOUR) {
      throw new HttpError(429, 'Too many code requests. Try again later.');
    }

    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000);
    const challenge = await app.prisma.otpChallenge.create({
      data: {
        userId: user.id,
        channel,
        destination,
        codeHash: hashSecret(code),
        expiresAt,
      },
    });

    await app.otpProvider.send({ destination, channel, code });

    reply.status(201);
    return requestOtpResponseSchema.parse({
      challengeId: challenge.id,
      expiresAt: expiresAt.toISOString(),
    });
  });

  app.post('/auth/otp/verify', async (request) => {
    const body = verifyOtpRequestSchema.parse(request.body);

    const challenge = await app.prisma.otpChallenge.findUnique({
      where: { id: body.challengeId },
      include: { user: { include: { teamMemberships: { include: { team: true } } } } },
    });

    if (
      !challenge ||
      challenge.consumedAt !== null ||
      challenge.expiresAt.getTime() < Date.now() ||
      challenge.attempts >= env.OTP_MAX_VERIFY_ATTEMPTS
    ) {
      throw new HttpError(401, INVALID_OR_EXPIRED_CODE);
    }

    if (!secretsMatch(hashSecret(body.code), challenge.codeHash)) {
      await app.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new HttpError(401, INVALID_OR_EXPIRED_CODE);
    }

    const token = generateSessionToken();
    const sessionExpiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await app.prisma.$transaction([
      app.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      }),
      app.prisma.session.create({
        data: {
          userId: challenge.user.id,
          tokenHash: hashSecret(token),
          expiresAt: sessionExpiresAt,
        },
      }),
    ]);

    return verifyOtpResponseSchema.parse({
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
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const token = header.slice('Bearer '.length);
      await app.prisma.session.updateMany({
        where: { tokenHash: hashSecret(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    reply.status(204).send();
  });
}
