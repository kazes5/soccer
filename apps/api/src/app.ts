import Fastify, { type FastifyInstance } from 'fastify';
import { env } from './env';
import prismaPlugin from './plugins/prisma';
import healthRoutes from './routes/health';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : true,
  });

  app.register(prismaPlugin);
  app.register(healthRoutes);

  return app;
}
