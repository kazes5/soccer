import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { hashSecret } from '../lib/crypto';

export interface CurrentUser {
  id: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: CurrentUser;
  }
}

export default fp(async (app: FastifyInstance) => {
  app.addHook('onRequest', async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return;
    }

    const token = header.slice('Bearer '.length);
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

    request.currentUser = { id: session.user.id, name: session.user.name };
    await app.prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });
  });
});
