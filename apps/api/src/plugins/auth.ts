import type { AuthMethod } from '../../generated/prisma/client';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { hashSecret } from '../lib/crypto';
import { resolveSessionToken } from '../lib/cookies';

export interface CurrentUser {
  id: string;
  name: string;
  sessionId: string;
  authMethod: AuthMethod;
  authenticatedAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: CurrentUser;
  }
}

export default fp(async (app: FastifyInstance) => {
  app.addHook('onRequest', async (request) => {
    const token = resolveSessionToken(request);
    if (!token) {
      return;
    }

    const session = await app.prisma.session.findUnique({
      where: { tokenHash: hashSecret(token) },
      include: { user: true },
    });

    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() < Date.now() ||
      !session.user.isActive
    ) {
      return;
    }

    request.currentUser = {
      id: session.user.id,
      name: session.user.name,
      sessionId: session.id,
      authMethod: session.authMethod,
      authenticatedAt: session.authenticatedAt,
    };
    await app.prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });
  });
});
