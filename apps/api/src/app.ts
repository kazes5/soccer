import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { env } from './env';
import { Prisma } from '../generated/prisma/client';
import { assertCsrfSafe } from './lib/cookies';
import { HttpError } from './lib/errors';
import { SimpleWebauthnVerifier, type WebauthnVerifier } from './lib/webauthn';
import {
  DisabledPasswordRecoveryProvider,
  type PasswordRecoveryProvider,
} from './lib/password-recovery';
import authPlugin from './plugins/auth';
import prismaPlugin from './plugins/prisma';
import queuesPlugin from './plugins/queues';
import ssePlugin from './plugins/sse';
import authRoutes from './routes/auth';
import auditLogRoutes from './routes/audit-logs';
import collectionPointRoutes from './routes/collection-points';
import coordinationSettingsRoutes from './routes/coordination-settings';
import healthRoutes from './routes/health';
import inviteRoutes from './routes/invites';
import memberPreferencesRoutes from './routes/member-preferences';
import memberRoutes from './routes/members';
import notificationRoutes from './routes/notifications';
import notificationSettingsRoutes from './routes/notification-settings';
import playerRoutes from './routes/players';
import pushSubscriptionRoutes from './routes/push-subscriptions';
import scheduleTemplateRoutes from './routes/schedule-templates';
import sessionRoutes from './routes/sessions';
import shiftRoutes from './routes/shifts';
import swapRequestRoutes from './routes/swap-requests';
import teamRoutes from './routes/teams';
import systemRoutes from './routes/system';

declare module 'fastify' {
  interface FastifyInstance {
    webauthnVerifier: WebauthnVerifier;
    sseHeartbeatIntervalMs: number;
    passwordRecoveryProvider: PasswordRecoveryProvider;
    passwordAuthEnabled: boolean;
    systemAdminEnabled: boolean;
  }
}

const DEFAULT_SSE_HEARTBEAT_INTERVAL_MS = 25_000;

export interface BuildAppOptions {
  /** Overrides the default (`@simplewebauthn/server`-backed) verifier — used in tests, since a
   *  real WebAuthn ceremony needs actual browser/authenticator crypto Vitest can't produce. */
  webauthnVerifier?: WebauthnVerifier;
  /** Overrides the notification stream's heartbeat/fallback-poll interval — used in tests so
   *  they don't have to wait out the real 25s interval to observe fallback-poll delivery. */
  sseHeartbeatIntervalMs?: number;
  passwordRecoveryProvider?: PasswordRecoveryProvider;
  passwordAuthEnabled?: boolean;
  systemAdminEnabled?: boolean;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : true,
    // Invitation and recovery routes carry opaque secrets. Avoid emitting raw
    // request URLs from the application logger; domain logs remain available.
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: env.TRUST_PROXY,
  });

  app.decorate('webauthnVerifier', options.webauthnVerifier ?? new SimpleWebauthnVerifier());
  app.decorate(
    'sseHeartbeatIntervalMs',
    options.sseHeartbeatIntervalMs ?? DEFAULT_SSE_HEARTBEAT_INTERVAL_MS,
  );
  app.decorate('systemAdminEnabled', options.systemAdminEnabled ?? env.SYSTEM_ADMIN_ENABLED);
  app.decorate('passwordAuthEnabled', options.passwordAuthEnabled ?? env.PASSWORD_AUTH_ENABLED);
  app.decorate(
    'passwordRecoveryProvider',
    options.passwordRecoveryProvider ?? new DisabledPasswordRecoveryProvider(),
  );

  app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    // `Last-Event-ID` is EventSource's own automatic reconnect header — the
    // browser preflights it like any other non-safelisted header, so it
    // needs to be explicitly allowed here or every reconnect fails CORS.
    allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token', 'Last-Event-ID'],
  });
  app.register(cookie);
  app.register(prismaPlugin);
  app.register(queuesPlugin);
  app.register(ssePlugin);
  app.register(authPlugin);
  app.addHook('onRequest', async (request) => {
    assertCsrfSafe(request);
  });
  app.register(healthRoutes);
  app.register(teamRoutes);
  app.register(inviteRoutes);
  app.register(authRoutes);
  app.register(auditLogRoutes);
  app.register(memberRoutes);
  app.register(pushSubscriptionRoutes);
  app.register(playerRoutes);
  app.register(collectionPointRoutes);
  app.register(scheduleTemplateRoutes);
  app.register(sessionRoutes);
  app.register(shiftRoutes);
  app.register(swapRequestRoutes);
  app.register(coordinationSettingsRoutes);
  app.register(notificationSettingsRoutes);
  app.register(memberPreferencesRoutes);
  app.register(notificationRoutes);
  app.register(systemRoutes);

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
