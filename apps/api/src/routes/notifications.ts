import {
  notificationListResponseSchema,
  notificationSchema,
  unreadNotificationCountResponseSchema,
} from '@soccer/contracts';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireTeamRole } from '../lib/authorization';
import { HttpError } from '../lib/errors';
import { fetchNotificationsSince } from '../lib/notification-replay';

type UserNotificationRow = Awaited<ReturnType<typeof fetchNotificationsSince>>[number];

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

  /**
   * Real-time in-app delivery per ADR 0001: one authenticated, team-scoped
   * `text/event-stream` per browser tab. Auth is the same cookie-based
   * `requireAuth`/`requireTeamRole` every other route here uses — `GET`
   * requests are exempt from the CSRF check (`assertCsrfSafe` in
   * `lib/cookies.ts`), and `EventSource` sends the session cookie
   * automatically via `withCredentials`, so no special-casing is needed.
   *
   * Delivery is layered for reliability, not just speed: a `plugins/sse.ts`
   * Redis-pub/sub dispatch (fed by the worker right after it processes an
   * `OutboxEvent`) is the low-latency path, and a periodic re-query
   * piggybacked on the heartbeat timer is the fallback that still delivers
   * within one interval even if a pub/sub message is dropped (Redis pub/sub
   * has no redelivery). Postgres (`UserNotification`) stays the single
   * source of truth throughout — a dispatch only ever means "go re-check",
   * never carries the payload itself.
   */
  app.get('/teams/:teamId/notifications/stream', async (request, reply) => {
    const params = teamParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    reply.hijack();
    const res = reply.raw;
    // `@fastify/cors`'s onRequest hook already computed the right
    // Access-Control-Allow-* headers onto the Fastify reply object before
    // this handler ran — but `reply.hijack()` means we write straight to the
    // raw response ourselves and never call `reply.send()`, which is what
    // would normally flush those headers. Without forwarding them here, the
    // browser silently rejects the whole credentialed response as a CORS
    // violation (surfacing to `EventSource`/`fetch` as an opaque connection
    // failure, not a visible CORS console error), and a failed `EventSource`
    // auto-retries forever without ever telling the app it failed.
    const corsOrigin = reply.getHeader('access-control-allow-origin');
    const corsCredentials = reply.getHeader('access-control-allow-credentials');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      ...(corsCredentials ? { 'Access-Control-Allow-Credentials': corsCredentials } : {}),
    });
    // Writes are guarded against an already-closed socket: `request.raw`'s
    // 'close' handler below is the normal cleanup path, but a client
    // disconnecting mid-tick can race a heartbeat/flush write against it,
    // and writing to a destroyed response can throw or emit an unhandled
    // stream 'error' rather than fail quietly.
    function safeWrite(chunk: string) {
      if (res.writableEnded || res.destroyed) return;
      res.write(chunk);
    }

    // Reconnect hint for the browser's automatic retry after a dropped
    // connection; independent of the server-side heartbeat interval below.
    safeWrite('retry: 5000\n\n');

    let cursor: string | null = null;
    let isFlushing = false;

    function sendRow(row: UserNotificationRow) {
      // Always advances the cursor, even for a row this build's contract
      // can't represent (e.g. a newer eventType from a rolling deploy) — a
      // malformed row must not stall every future flush behind it forever.
      const parsed = notificationSchema.safeParse({
        id: row.id,
        teamId: row.teamId,
        eventType: row.eventType,
        category: row.category,
        severity: row.severity,
        payload: row.payload,
        readAt: row.readAt?.toISOString() ?? null,
        dismissedAt: row.dismissedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      });
      cursor = row.id;
      if (!parsed.success) {
        app.log.error(
          { err: parsed.error, notificationId: row.id },
          'Skipping a notification row the SSE stream could not validate.',
        );
        return;
      }
      safeWrite(`id: ${row.id}\nevent: notification\ndata: ${JSON.stringify(parsed.data)}\n\n`);
    }

    // A pub/sub dispatch and the heartbeat's own poll can race to call this
    // concurrently; the guard makes a second overlapping call a no-op rather
    // than risking two queries racing to advance `cursor` out of order.
    async function flush() {
      if (isFlushing) return;
      isFlushing = true;
      try {
        const rows = await fetchNotificationsSince(app.prisma, {
          userId: currentUser.id,
          teamId: params.teamId,
          afterId: cursor,
        });
        for (const row of rows) sendRow(row);
      } finally {
        isFlushing = false;
      }
    }

    // `flush()` is also invoked from callbacks outside this handler's own
    // promise chain (the registry dispatch below, and the heartbeat
    // interval) — a rejection there isn't caught by anything, and would
    // otherwise crash the process via Node's unhandledRejection handling,
    // dropping every open SSE connection for every team, not just this one.
    function flushSafely() {
      flush().catch((error: unknown) => {
        app.log.error({ err: error }, 'Notification stream flush failed.');
      });
    }

    const lastEventIdHeader = request.headers['last-event-id'];
    if (typeof lastEventIdHeader === 'string' && lastEventIdHeader.length > 0) {
      // Reconnect: the browser is telling us exactly where it left off.
      cursor = lastEventIdHeader;
      await flush();
    } else {
      // Fresh connect: the caller's initial page load already pulled history
      // via the REST list endpoint, so don't replay it again here — just
      // establish a baseline cursor (via a synthetic `id`-carrying comment
      // event) so the browser's own automatic reconnect already carries a
      // correct `Last-Event-ID` even if this connection drops before any
      // real event fires.
      const mostRecent = await app.prisma.userNotification.findFirst({
        where: { userId: currentUser.id, teamId: params.teamId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      if (mostRecent) {
        cursor = mostRecent.id;
        safeWrite(`id: ${mostRecent.id}\nevent: sync\ndata: {}\n\n`);
      }
    }

    const connectionId = randomUUID();
    app.sseRegistry.add({ id: connectionId, userId: currentUser.id, teamId: params.teamId }, () => {
      flushSafely();
    });

    const heartbeat = setInterval(() => {
      safeWrite(': heartbeat\n\n');
      flushSafely();
    }, app.sseHeartbeatIntervalMs);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      app.sseRegistry.remove(connectionId);
    });
  });
}
