import { healthStatusSchema } from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    return healthStatusSchema.parse({
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', async (_request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch (error) {
      app.log.warn({ error }, 'readiness check failed: database unreachable');
      reply.status(503);
      return { status: 'unavailable' };
    }
  });
}
