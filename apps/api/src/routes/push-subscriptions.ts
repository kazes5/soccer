import {
  createPushSubscriptionRequestSchema,
  deletePushSubscriptionRequestSchema,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/authorization';

export default async function pushSubscriptionRoutes(app: FastifyInstance) {
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
