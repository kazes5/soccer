import type { FastifyInstance } from 'fastify';
import { env } from '../env';
import { HttpError } from './errors';

/**
 * Mirrors auth.ts's login-attempt rate limiting: advisory-lock-serialized so
 * a burst of concurrent requests can't all observe the same pre-increment
 * count, checked against a rolling one-hour window. Unlike login (which only
 * counts *failures*), every chat request counts here — each one reaches the
 * paid OpenRouter API regardless of outcome, so this bounds spend, not just
 * abuse.
 */
export async function assertChatRateLimit(
  app: FastifyInstance,
  userId: string,
  requestIp: string,
): Promise<void> {
  await app.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtextextended(${`chat-user:${userId}`}, 0))
    `;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [userCount, ipCount] = await Promise.all([
      tx.chatRequestAttempt.count({ where: { userId, createdAt: { gte: oneHourAgo } } }),
      tx.chatRequestAttempt.count({ where: { requestIp, createdAt: { gte: oneHourAgo } } }),
    ]);
    if (
      userCount >= env.CHAT_MAX_REQUESTS_PER_USER_PER_HOUR ||
      ipCount >= env.CHAT_MAX_REQUESTS_PER_IP_PER_HOUR
    ) {
      throw new HttpError(429, 'Too many chat messages. Try again later.');
    }
    await tx.chatRequestAttempt.create({ data: { userId, requestIp } });
  });
}
