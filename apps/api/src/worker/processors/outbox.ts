import type IORedis from 'ioredis';
import type { OutboxEvent, Prisma, PrismaClient } from '../../../generated/prisma/client';
import { publishNotificationFanoutBestEffort } from '../../lib/notification-bus';

async function resolveRecipientIds(prisma: PrismaClient, event: OutboxEvent): Promise<string[]> {
  switch (event.recipientScope) {
    case 'team_broadcast': {
      const members = await prisma.teamMember.findMany({
        where: { teamId: event.teamId },
        select: { userId: true },
      });
      return members.map((member) => member.userId);
    }
    case 'participants':
      return event.participantUserIds;
    case 'self':
      return event.selfUserId ? [event.selfUserId] : [];
  }
}

/**
 * Fans one `OutboxEvent` out into a `UserNotification` (plus an `in_app`
 * `NotificationDelivery`) per resolved recipient, then marks the event
 * processed. Idempotent throughout: a no-op if the event is missing or
 * already processed, and safe to re-run after a partial prior attempt — the
 * fan-out uses `skipDuplicates`, so a retry can't create a second
 * notification for a recipient who already got one.
 *
 * `publisher`, if given, gets a best-effort Redis pub/sub fanout message
 * after the transaction commits — the low-latency path SSE connections in
 * the (separate) API process listen to. It's optional and only ever called
 * post-commit so a dropped message never implies a missing row: the SSE
 * route's own periodic poll (`fetchNotificationsSince`) is the fallback that
 * makes delivery eventually-consistent even with no publisher at all, which
 * is what every existing caller of this function (worker/reconcile tests)
 * relies on by omitting it.
 */
export async function processOutboxEvent(
  prisma: PrismaClient,
  outboxEventId: string,
  publisher?: IORedis,
): Promise<void> {
  const event = await prisma.outboxEvent.findUnique({ where: { id: outboxEventId } });
  if (!event || event.processedAt) return;

  const recipientIds = await resolveRecipientIds(prisma, event);

  await prisma.$transaction(async (tx) => {
    if (recipientIds.length > 0) {
      await tx.userNotification.createMany({
        data: recipientIds.map((userId) => ({
          outboxEventId: event.id,
          userId,
          teamId: event.teamId,
          eventType: event.eventType,
          category: event.category,
          severity: event.severity,
          payload: event.payload as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });

      const notifications = await tx.userNotification.findMany({
        where: { outboxEventId: event.id },
        select: { id: true },
      });
      await tx.notificationDelivery.createMany({
        data: notifications.map((notification) => ({
          userNotificationId: notification.id,
          channel: 'in_app' as const,
          deliveredAt: new Date(),
        })),
        skipDuplicates: true,
      });
    }

    await tx.outboxEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
  });

  if (recipientIds.length > 0 && publisher) {
    publishNotificationFanoutBestEffort(publisher, {
      outboxEventId: event.id,
      teamId: event.teamId,
      userIds: recipientIds,
    });
  }
}
