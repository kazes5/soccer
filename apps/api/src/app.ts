import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { env } from './env';
import { Prisma } from '../generated/prisma/client';
import { assertCsrfSafe } from './lib/cookies';
import { HttpError } from './lib/errors';
import { SimpleWebauthnVerifier, type WebauthnVerifier } from './lib/webauthn';
import authPlugin from './plugins/auth';
import prismaPlugin from './plugins/prisma';
import queuesPlugin from './plugins/queues';
import authRoutes from './routes/auth';
import collectionPointRoutes from './routes/collection-points';
import coordinationSettingsRoutes from './routes/coordination-settings';
import healthRoutes from './routes/health';
import inviteRoutes from './routes/invites';
import memberPreferencesRoutes from './routes/member-preferences';
import memberRoutes from './routes/members';
import notificationSettingsRoutes from './routes/notification-settings';
import playerRoutes from './routes/players';
import pushSubscriptionRoutes from './routes/push-subscriptions';
import scheduleTemplateRoutes from './routes/schedule-templates';
import sessionRoutes from './routes/sessions';
import shiftRoutes from './routes/shifts';
import teamRoutes from './routes/teams';

declare module 'fastify' {
  interface FastifyInstance {
    webauthnVerifier: WebauthnVerifier;
  }
}

export interface BuildAppOptions {
  /** Overrides the default (`@simplewebauthn/server`-backed) verifier — used in tests, since a
   *  real WebAuthn ceremony needs actual browser/authenticator crypto Vitest can't produce. */
  webauthnVerifier?: WebauthnVerifier;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : true,
    trustProxy: env.TRUST_PROXY,
  });

  app.decorate('webauthnVerifier', options.webauthnVerifier ?? new SimpleWebauthnVerifier());

  app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'],
  });
  app.register(cookie);
  app.register(prismaPlugin);
  app.register(queuesPlugin);
  app.register(authPlugin);
  app.addHook('onRequest', async (request) => {
    assertCsrfSafe(request);
  });
  app.register(healthRoutes);
  app.register(teamRoutes);
  app.register(inviteRoutes);
  app.register(authRoutes);
  app.register(memberRoutes);
  app.register(pushSubscriptionRoutes);
  app.register(playerRoutes);
  app.register(collectionPointRoutes);
  app.register(scheduleTemplateRoutes);
  app.register(sessionRoutes);
  app.register(shiftRoutes);
  app.register(coordinationSettingsRoutes);
  app.register(notificationSettingsRoutes);
  app.register(memberPreferencesRoutes);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.status(error.statusCode).send({ message: error.message, ...error.details });
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send({ message: 'Invalid request.', issues: error.issues });
      return;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      reply.status(404).send({ message: 'Not found.' });
      return;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      reply.status(409).send({ message: 'This conflicts with an existing record.' });
      return;
    }

    if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      reply.status(error.statusCode).send({ message: error.message });
      return;
    }

    app.log.error(error);
    reply.status(500).send({ message: 'Internal server error.' });
  });

  return app;
}
