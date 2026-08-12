import type { PrismaClient } from '../../generated/prisma/client';

/**
 * Defensive cap on how much history a single reconnect/poll can replay in one
 * query. A connection gapped longer than this shows a partial replay; the
 * client's own page-load REST pull (GET .../notifications) already covers the
 * rest, so this only trades completeness of the live stream's backfill for a
 * bounded query cost.
 */
const REPLAY_LIMIT = 200;

/**
 * Every `UserNotification` for this user/team created after `afterId`'s row,
 * oldest first. Reuses the same cursor mechanism the REST list endpoint's
 * pagination already relies on (`cursor: { id }, skip: 1`) — Prisma resolves
 * the cursor by the row's own id, independent of sort direction, so this is
 * exactly SSE's Last-Event-ID replay with no separate event log needed.
 *
 * `afterId: null` returns the caller's entire history — callers must only
 * pass `null` when a full backfill is genuinely intended.
 */
export async function fetchNotificationsSince(
  prisma: PrismaClient,
  params: { userId: string; teamId: string; afterId: string | null },
) {
  return prisma.userNotification.findMany({
    where: { userId: params.userId, teamId: params.teamId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: REPLAY_LIMIT,
    ...(params.afterId ? { cursor: { id: params.afterId }, skip: 1 } : {}),
  });
}
