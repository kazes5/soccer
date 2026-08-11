import type { Queue } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { createOutboxQueue, createScheduledTaskQueue } from '../lib/queues';
import { createRedisConnection } from '../lib/redis';

declare module 'fastify' {
  interface FastifyInstance {
    outboxQueue: Queue<{ outboxEventId: string }>;
    scheduledTaskQueue: Queue<{ scheduledTaskId: string }>;
  }
}

/**
 * Decorates the app with the same queues the worker consumes, so a route
 * can best-effort enqueue a job right after its transaction commits (see
 * `recordOutboxEvent`/`recordScheduledTask`) — purely an optimization for
 * lower latency. Nothing calls these yet (Checkpoint 4 retrofits routes to
 * write outbox events); the worker's own startup reconciliation is what
 * actually guarantees delivery regardless of whether this enqueue runs.
 */
export default fp(async (app: FastifyInstance) => {
  const outboxConnection = createRedisConnection();
  const scheduledTaskConnection = createRedisConnection();
  const outboxQueue = createOutboxQueue(outboxConnection);
  const scheduledTaskQueue = createScheduledTaskQueue(scheduledTaskConnection);

  app.decorate('outboxQueue', outboxQueue);
  app.decorate('scheduledTaskQueue', scheduledTaskQueue);

  app.addHook('onClose', async () => {
    await Promise.all([
      outboxQueue.close(),
      scheduledTaskQueue.close(),
      outboxConnection.quit(),
      scheduledTaskConnection.quit(),
    ]);
  });
});
