import {
  createPushSubscriptionRequestSchema,
  deletePushSubscriptionRequestSchema,
  pushConfigResponseSchema,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { env } from '../env';
import { requireAuth } from '../lib/authorization';

export default async function pushSubscriptionRoutes(app: FastifyInstance) {
  // `publicKey` is safe to expose to any authenticated caller — it's the
  // same value `pushManager.subscribe()` needs client-side, not a secret
  // (only VAPID_PRIVATE_KEY, which never leaves the worker process, is).
  // `null` when VAPID isn't configured, so the client can show "push isn't
  // available" instead of attempting a subscribe that can only fail.
  app.get('/push-subscriptions/config', async (request) => {
    requireAuth(request);
    return pushConfigResponseSchema.parse({ publicKey: env.VAPID_PUBLIC_KEY ?? null });
  });

  app.post('/push-subscriptions', async (request, reply) => {
    const body = createPushSubscriptionRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);

    await app.prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        userId: currentUser.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
      update: {
        userId: currentUser.id,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    });

    reply.status(204).send();
  });

  app.delete('/push-subscriptions', async (request, reply) => {
    const body = deletePushSubscriptionRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);

    await app.prisma.pushSubscription.deleteMany({
      where: { endpoint: body.endpoint, userId: currentUser.id },
    });

    reply.status(204).send();
  });
}
