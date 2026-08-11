import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { subscribeNotificationFanout } from '../lib/notification-bus';
import { createRedisConnection } from '../lib/redis';
import { SseRegistry } from '../lib/sse-registry';

declare module 'fastify' {
  interface FastifyInstance {
    sseRegistry: SseRegistry;
  }
}

/**
 * Decorates the app with an in-memory registry of open SSE connections and a
 * dedicated Redis subscriber that dispatches to it whenever the worker
 * process publishes a fanout message (see `lib/notification-bus.ts`) —
 * bridging the worker process, which creates `UserNotification` rows, and
 * this API process, which holds the SSE connections that need to know about
 * them. The registry only holds callbacks, never the notification rows
 * themselves; each connection re-queries Postgres for anything new (see the
 * stream route in `routes/notifications.ts`), so a dispatch is a "wake up
 * and check" signal, not the payload itself.
 */
export default fp(async (app: FastifyInstance) => {
  const registry = new SseRegistry();
  app.decorate('sseRegistry', registry);

  const subscriber = createRedisConnection();
  subscribeNotificationFanout(subscriber, (message) => {
    registry.dispatch(message.teamId, message.userIds);
  });

  app.addHook('onClose', async () => {
    await subscriber.quit();
  });
});
