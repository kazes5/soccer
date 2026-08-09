import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { env } from './env';
import { Prisma } from '../generated/prisma/client';
import { HttpError } from './lib/errors';
import { ConsoleOtpProvider, type OtpProvider } from './lib/otp-provider';
import authPlugin from './plugins/auth';
import prismaPlugin from './plugins/prisma';
import authRoutes from './routes/auth';
import healthRoutes from './routes/health';
import inviteRoutes from './routes/invites';
import teamRoutes from './routes/teams';

declare module 'fastify' {
  interface FastifyInstance {
    otpProvider: OtpProvider;
  }
}

export interface BuildAppOptions {
  /** Overrides the default (log-only) OTP delivery provider — used in tests. */
  otpProvider?: OtpProvider;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : true,
  });

  app.decorate(
    'otpProvider',
    options.otpProvider ?? new ConsoleOtpProvider((msg) => app.log.info(msg)),
  );

  app.register(cors, {
    origin: env.WEB_ORIGIN,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.register(prismaPlugin);
  app.register(authPlugin);
  app.register(healthRoutes);
  app.register(teamRoutes);
  app.register(inviteRoutes);
  app.register(authRoutes);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.status(error.statusCode).send({ message: error.message });
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

    app.log.error(error);
    reply.status(500).send({ message: 'Internal server error.' });
  });

  return app;
}
