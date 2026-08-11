import {
  notificationListResponseSchema,
  unreadNotificationCountResponseSchema,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireTeamRole } from '../lib/authorization';
import { HttpError } from '../lib/errors';

const teamParamsSchema = z.object({ teamId: z.string().uuid() });
const notificationParamsSchema = z.object({
  teamId: z.string().uuid(),
  notificationId: z.string().uuid(),
});
const listQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * The set of "unread and still visible" notifications for a user+team —
 * deliberately shared, not per-endpoint, by both the unread-count query and
 * `POST .../read-all`'s mutation: "how many are unread" and "mark all
 * unread ones read" must always agree on exactly the same set, or read-all
 * would silently stop matching what the badge reports.
 */
function unreadVisibleWhere(userId: string, teamId: string) {
  return { userId, teamId, readAt: null, dismissedAt: null };
}

/** Loads a `UserNotification` the caller owns, or throws 404 — same 404 for
 * "doesn't exist" and "belongs to someone else" so the response can't be
 * used to probe for another team member's notification ids. Shared by the
 * read and dismiss endpoints below, which otherwise duplicated this check. */
async function loadOwnNotificationOrThrow(
  prisma: FastifyInstance['prisma'],
  teamId: string,
  notificationId: string,
  userId: string,
) {
  const notification = await prisma.userNotification.findUnique({
    where: { id: notificationId },
  });
  if (!notification || notification.teamId !== teamId || notification.userId !== userId) {
    throw new HttpError(404, 'Notification not found.');
  }
  return notification;
}

export default async function notificationRoutes(app: FastifyInstance) {
  app.get('/teams/:teamId/notifications', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const query = listQuerySchema.parse(request.query);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const [rows, unreadCount] = await Promise.all([
      app.prisma.userNotification.findMany({
        where: { userId: currentUser.id, teamId: params.teamId, dismissedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        take: query.limit + 1,
      }),
      app.prisma.userNotification.count({
        where: unreadVisibleWhere(currentUser.id, params.teamId),
      }),
    ]);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return notificationListResponseSchema.parse({
      notifications: page.map((row) => ({
        id: row.id,
        teamId: row.teamId,
        eventType: row.eventType,
        category: row.category,
        severity: row.severity,
        payload: row.payload,
        readAt: row.readAt?.toISOString() ?? null,
        dismissedAt: row.dismissedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      unreadCount,
    });
  });

  app.get('/teams/:teamId/notifications/unread-count', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const count = await app.prisma.userNotification.count({
      where: unreadVisibleWhere(currentUser.id, params.teamId),
    });

    return unreadNotificationCountResponseSchema.parse({ count });
  });

  app.post('/teams/:teamId/notifications/:notificationId/read', async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const notification = await loadOwnNotificationOrThrow(
      app.prisma,
      params.teamId,
      params.notificationId,
      currentUser.id,
    );

    if (!notification.readAt) {
      await app.prisma.userNotification.update({
        where: { id: params.notificationId },
        data: { readAt: new Date() },
      });
    }

    reply.status(204).send();
  });

  app.post('/teams/:teamId/notifications/:notificationId/dismiss', async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const notification = await loadOwnNotificationOrThrow(
      app.prisma,
      params.teamId,
      params.notificationId,
      currentUser.id,
    );

    if (!notification.dismissedAt) {
      await app.prisma.userNotification.update({
        where: { id: params.notificationId },
        data: { dismissedAt: new Date() },
      });
    }

    reply.status(204).send();
  });

  app.post('/teams/:teamId/notifications/read-all', async (request, reply) => {
    const params = teamParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    await app.prisma.userNotification.updateMany({
      where: unreadVisibleWhere(currentUser.id, params.teamId),
      data: { readAt: new Date() },
    });

    reply.status(204).send();
  });
}
