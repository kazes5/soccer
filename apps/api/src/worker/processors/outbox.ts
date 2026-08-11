import type { OutboxEvent, Prisma, PrismaClient } from '../../../generated/prisma/client';

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
 */
export async function processOutboxEvent(
  prisma: PrismaClient,
  outboxEventId: string,
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
}
