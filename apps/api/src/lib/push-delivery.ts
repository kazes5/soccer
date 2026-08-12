import { QUIET_HOURS_END_DEFAULT, QUIET_HOURS_START_DEFAULT } from '@soccer/contracts';
import type { Locale } from '@soccer/i18n';
import type { OutboxEvent, PrismaClient } from '../../generated/prisma/client';
import { decidePushAction, entityKeyFor, THROTTLE_WINDOW_MS } from './notification-throttle';
import { buildPushPayload, buildSummaryPushPayload, type PushPayloadContent } from './push-payload';
import { isWithinQuietHours } from './timezone';
import type { WebPushProvider } from './web-push';

/**
 * Sends browser push for one `OutboxEvent`'s already-created `UserNotification`
 * rows, per ADR 0001: opt-in by category, gated by quiet hours and the
 * collapse/throttle rules (both bypassed for `emergency`-severity events).
 * Runs entirely after `processOutboxEvent`'s transaction commits — a network
 * call to a push service has no place inside a DB transaction — so this
 * takes its own fresh reads rather than reusing anything from that
 * transaction.
 *
 * Never throws: once the transaction has committed, `processOutboxEvent`
 * only re-enters on `event.processedAt` being unset, which it already is by
 * the time this runs — so a push failure here can never be retried by
 * re-running the job, only logged. In-app delivery (already complete before
 * this call) remains the source of truth regardless of push outcome; this
 * checkpoint is deliberately single-attempt per event, not a retry loop —
 * `NotificationDelivery.attempts`/`lastError` make failures visible, but
 * scheduled re-delivery is out of scope here (reminders/escalations, which
 * do need that, are their own later checkpoints).
 */
export async function deliverPushNotifications(
  prisma: PrismaClient,
  event: OutboxEvent,
  webPush: WebPushProvider,
  /** Overridable only so tests can make quiet-hours gating deterministic
   *  instead of depending on the real wall-clock time when they happen to
   *  run; production call sites always omit it. */
  now: Date = new Date(),
): Promise<void> {
  if (!webPush.isConfigured) return;

  try {
    const [notifications, team] = await Promise.all([
      prisma.userNotification.findMany({
        where: { outboxEventId: event.id },
        select: { id: true, userId: true },
      }),
      prisma.team.findUnique({ where: { id: event.teamId }, select: { timezone: true } }),
    ]);
    if (!team) return;

    for (const notification of notifications) {
      await deliverToRecipient(prisma, event, notification, team.timezone, webPush, now).catch(
        (error: unknown) => {
          // One recipient's failure (a DB hiccup, an unexpected error
          // building the payload) must not stop delivery to the others.
          console.error(`[push] delivery failed for user ${notification.userId}:`, error);
        },
      );
    }
  } catch (error) {
    console.error(`[push] delivery setup failed for outbox event ${event.id}:`, error);
  }
}

async function deliverToRecipient(
  prisma: PrismaClient,
  event: OutboxEvent,
  notification: { id: string; userId: string },
  teamTimezone: string,
  webPush: WebPushProvider,
  now: Date,
): Promise<void> {
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: notification.userId },
  });
  if (subscriptions.length === 0) return;

  const [user, categoryPreference] = await Promise.all([
    prisma.user.findUnique({
      where: { id: notification.userId },
      select: { languagePreference: true },
    }),
    prisma.notificationPreference.findUnique({
      where: {
        userId_teamId_category_channel: {
          userId: notification.userId,
          teamId: event.teamId,
          category: event.category,
          channel: 'push',
        },
      },
    }),
  ]);
  if (!user) return;
  // Opt-out model: a category is enabled unless a row explicitly disables it
  // — mirrors member-preferences.ts's buildCategoryPreferences default.
  if (categoryPreference?.enabled === false) return;

  const locale = user.languagePreference as Locale;
  const isEmergency = event.severity === 'emergency';
  const payload = await resolvePayload(
    prisma,
    event,
    notification,
    teamTimezone,
    locale,
    now,
    isEmergency,
  );
  if (!payload) return;

  const results = await Promise.all(
    subscriptions.map(async (subscription) => ({
      subscription,
      result: await webPush.send(
        { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
        JSON.stringify(payload),
      ),
    })),
  );

  const goneSubscriptionIds = results
    .filter(({ result }) => !result.ok && result.shouldRemoveSubscription)
    .map(({ subscription }) => subscription.id);
  if (goneSubscriptionIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: goneSubscriptionIds } } });
  }

  // The schema records one push delivery row per notification, not per
  // subscription (a user can have several devices subscribed) — this
  // records the aggregate outcome across all of them: delivered if any
  // subscription received it, the last failure otherwise.
  const delivered = results.some(({ result }) => result.ok);
  const failure = results.find(({ result }) => !result.ok);
  const lastError = !delivered && failure && !failure.result.ok ? failure.result.error : null;

  await prisma.notificationDelivery.upsert({
    where: { userNotificationId_channel: { userNotificationId: notification.id, channel: 'push' } },
    create: {
      userNotificationId: notification.id,
      channel: 'push',
      attempts: 1,
      deliveredAt: delivered ? now : null,
      lastError,
    },
    update: {
      attempts: { increment: 1 },
      ...(delivered ? { deliveredAt: now, lastError: null } : { lastError }),
    },
  });
}

async function resolvePayload(
  prisma: PrismaClient,
  event: OutboxEvent,
  notification: { id: string; userId: string },
  teamTimezone: string,
  locale: Locale,
  now: Date,
  isEmergency: boolean,
): Promise<PushPayloadContent | null> {
  const eventPayload = event.payload as Record<string, unknown>;

  if (isEmergency) {
    return buildPushPayload(locale, event.teamId, {
      eventType: event.eventType,
      payload: eventPayload,
    });
  }

  const [teamSettings, memberSettings] = await Promise.all([
    prisma.teamNotificationSettings.findUnique({ where: { teamId: event.teamId } }),
    prisma.memberNotificationSettings.findUnique({
      where: { userId_teamId: { userId: notification.userId, teamId: event.teamId } },
    }),
  ]);
  const quietHoursStart =
    memberSettings?.quietHoursStart ?? teamSettings?.quietHoursStart ?? QUIET_HOURS_START_DEFAULT;
  const quietHoursEnd =
    memberSettings?.quietHoursEnd ?? teamSettings?.quietHoursEnd ?? QUIET_HOURS_END_DEFAULT;
  if (isWithinQuietHours(now, teamTimezone, quietHoursStart, quietHoursEnd)) return null;

  const recentDeliveries = await prisma.notificationDelivery.findMany({
    where: {
      channel: 'push',
      deliveredAt: { not: null },
      userNotification: {
        userId: notification.userId,
        teamId: event.teamId,
        createdAt: { gte: new Date(now.getTime() - THROTTLE_WINDOW_MS) },
      },
    },
    select: { createdAt: true, userNotification: { select: { eventType: true, payload: true } } },
  });
  const recentPushes = recentDeliveries.map((delivery) => ({
    createdAt: delivery.createdAt,
    entityKey: entityKeyFor(
      delivery.userNotification.eventType,
      delivery.userNotification.payload as Record<string, unknown>,
    ),
  }));
  const entityKey = entityKeyFor(event.eventType, eventPayload);
  const action = decidePushAction(recentPushes, now, entityKey);

  if (action === 'collapse' || action === 'throttle') return null;
  if (action === 'summary') return buildSummaryPushPayload(locale);
  return buildPushPayload(locale, event.teamId, {
    eventType: event.eventType,
    payload: eventPayload,
  });
}
