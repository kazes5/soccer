import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Prisma } from '../generated/prisma/client';
import { deliverPushNotifications } from '../src/lib/push-delivery';
import type { PushSubscriptionKeys, WebPushProvider, WebPushSendResult } from '../src/lib/web-push';

/** Records every send in memory and returns a configurable result — the
 * same "no real network/crypto needed in tests" role `WebauthnVerifier`
 * plays for passkeys. */
class FakeWebPushProvider implements WebPushProvider {
  isConfigured = true;
  sent: { subscription: PushSubscriptionKeys; payload: Record<string, unknown> }[] = [];
  nextResult: WebPushSendResult = { ok: true };

  async send(subscription: PushSubscriptionKeys, payload: string): Promise<WebPushSendResult> {
    this.sent.push({ subscription, payload: JSON.parse(payload) as Record<string, unknown> });
    return this.nextResult;
  }
}

// 2026-08-12T12:00:00Z is 15:00 in Asia/Jerusalem (UTC+3, deep in DST) — well
// outside the default 22:00-07:00 quiet-hours window.
const DAYTIME = new Date('2026-08-12T12:00:00.000Z');
// 20:00Z is 23:00 in Asia/Jerusalem — inside the default quiet-hours window.
const QUIET_HOURS = new Date('2026-08-12T20:00:00.000Z');

describe('deliverPushNotifications', () => {
  const app = buildApp();
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  async function setUpTeam() {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPhone: `+1555230${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const body = teamResponse.json();
    createdTeamIds.push(body.team.id);
    createdUserIds.push(body.admin.id);
    return { teamId: body.team.id as string, userId: body.admin.id as string };
  }

  async function subscribe(userId: string) {
    return app.prisma.pushSubscription.create({
      data: {
        userId,
        endpoint: `https://push.example.test/${userId}/${Math.random().toString(36).slice(2)}`,
        p256dh: 'p256dh-key',
        auth: 'auth-key',
      },
    });
  }

  async function createEventWithNotification(
    teamId: string,
    userId: string,
    overrides: {
      eventType?: string;
      category?: 'shift_changes' | 'swaps' | 'reminders' | 'escalations' | 'admin_changes';
      severity?: 'normal' | 'emergency';
      payload?: Record<string, unknown>;
      createdAt?: Date;
    } = {},
  ) {
    const eventType = overrides.eventType ?? 'shift_claimed';
    const category = overrides.category ?? 'shift_changes';
    const severity = overrides.severity ?? 'normal';
    const payload = overrides.payload ?? {
      byUserName: 'Avi Levi',
      direction: 'to_practice',
      pointName: 'Oak St',
      sessionId: 'session-1',
      shiftId: 'shift-1',
    };

    const event = await app.prisma.outboxEvent.create({
      data: {
        teamId,
        eventType,
        category,
        severity,
        recipientScope: 'self',
        selfUserId: userId,
        payload: payload as Prisma.InputJsonValue,
      },
    });
    const notification = await app.prisma.userNotification.create({
      data: {
        outboxEventId: event.id,
        userId,
        teamId,
        eventType,
        category,
        severity,
        payload: payload as Prisma.InputJsonValue,
      },
    });
    if (overrides.createdAt) {
      await app.prisma.userNotification.update({
        where: { id: notification.id },
        data: { createdAt: overrides.createdAt },
      });
    }
    return { event, notification };
  }

  /** Directly records a prior *delivered* push, without going through
   * `deliverPushNotifications` — for seeding collapse/throttle history fast. */
  async function seedPriorDelivery(
    teamId: string,
    userId: string,
    options: { shiftId: string; createdAt: Date },
  ) {
    const { notification } = await createEventWithNotification(teamId, userId, {
      payload: { shiftId: options.shiftId, sessionId: 'session-1', pointName: 'Oak St' },
      createdAt: options.createdAt,
    });
    await app.prisma.notificationDelivery.create({
      data: {
        userNotificationId: notification.id,
        channel: 'push',
        deliveredAt: options.createdAt,
      },
    });
  }

  it('sends to a subscribed user and records a delivered push NotificationDelivery row', async () => {
    const { teamId, userId } = await setUpTeam();
    await subscribe(userId);
    const { event, notification } = await createEventWithNotification(teamId, userId);
    const webPush = new FakeWebPushProvider();

    await deliverPushNotifications(app.prisma, event, webPush, DAYTIME);

    expect(webPush.sent).toHaveLength(1);
    expect(webPush.sent[0]?.payload).toMatchObject({ title: 'Shift claimed' });
    const delivery = await app.prisma.notificationDelivery.findUnique({
      where: {
        userNotificationId_channel: { userNotificationId: notification.id, channel: 'push' },
      },
    });
    expect(delivery?.deliveredAt).not.toBeNull();
  });

  it('skips a user with no push subscription', async () => {
    const { teamId, userId } = await setUpTeam();
    const { event } = await createEventWithNotification(teamId, userId);
    const webPush = new FakeWebPushProvider();

    await deliverPushNotifications(app.prisma, event, webPush, DAYTIME);

    expect(webPush.sent).toHaveLength(0);
  });

  it('skips a user who disabled push for this category', async () => {
    const { teamId, userId } = await setUpTeam();
    await subscribe(userId);
    await app.prisma.notificationPreference.create({
      data: { userId, teamId, category: 'shift_changes', channel: 'push', enabled: false },
    });
    const { event } = await createEventWithNotification(teamId, userId);
    const webPush = new FakeWebPushProvider();

    await deliverPushNotifications(app.prisma, event, webPush, DAYTIME);

    expect(webPush.sent).toHaveLength(0);
  });

  it('skips a normal-severity event during quiet hours', async () => {
    const { teamId, userId } = await setUpTeam();
    await subscribe(userId);
    const { event } = await createEventWithNotification(teamId, userId);
    const webPush = new FakeWebPushProvider();

    await deliverPushNotifications(app.prisma, event, webPush, QUIET_HOURS);

    expect(webPush.sent).toHaveLength(0);
  });

  it('sends an emergency-severity event even during quiet hours', async () => {
    const { teamId, userId } = await setUpTeam();
    await subscribe(userId);
    const { event } = await createEventWithNotification(teamId, userId, { severity: 'emergency' });
    const webPush = new FakeWebPushProvider();

    await deliverPushNotifications(app.prisma, event, webPush, QUIET_HOURS);

    expect(webPush.sent).toHaveLength(1);
  });

  it('collapses a second push for the same entity within 60 seconds', async () => {
    const { teamId, userId } = await setUpTeam();
    await subscribe(userId);
    await seedPriorDelivery(teamId, userId, {
      shiftId: 'shift-1',
      createdAt: new Date(DAYTIME.getTime() - 30_000),
    });
    const { event } = await createEventWithNotification(teamId, userId, {
      payload: { shiftId: 'shift-1', sessionId: 'session-1', pointName: 'Oak St' },
    });
    const webPush = new FakeWebPushProvider();

    await deliverPushNotifications(app.prisma, event, webPush, DAYTIME);

    expect(webPush.sent).toHaveLength(0);
  });

  it('sends a generic summary for the 6th non-urgent push in 5 minutes, then suppresses the 7th', async () => {
    const { teamId, userId } = await setUpTeam();
    await subscribe(userId);
    for (let i = 0; i < 5; i += 1) {
      await seedPriorDelivery(teamId, userId, {
        shiftId: `shift-${i}`,
        createdAt: new Date(DAYTIME.getTime() - (i + 1) * 1000),
      });
    }

    const sixth = await createEventWithNotification(teamId, userId, {
      payload: { shiftId: 'shift-sixth', sessionId: 'session-1', pointName: 'Oak St' },
    });
    const webPushForSixth = new FakeWebPushProvider();
    await deliverPushNotifications(app.prisma, sixth.event, webPushForSixth, DAYTIME);
    expect(webPushForSixth.sent).toHaveLength(1);
    expect(webPushForSixth.sent[0]?.payload).toMatchObject({ title: 'Team has updates' });

    // Mark the summary itself as delivered so it counts toward the window,
    // exactly like a real send would (deliverPushNotifications already did
    // this above) — now there are 6 prior delivered pushes in the window.
    const seventh = await createEventWithNotification(teamId, userId, {
      payload: { shiftId: 'shift-seventh', sessionId: 'session-1', pointName: 'Oak St' },
    });
    const webPushForSeventh = new FakeWebPushProvider();
    await deliverPushNotifications(app.prisma, seventh.event, webPushForSeventh, DAYTIME);
    expect(webPushForSeventh.sent).toHaveLength(0);
  });

  it('deletes a subscription the push service reports as gone (410)', async () => {
    const { teamId, userId } = await setUpTeam();
    const subscription = await subscribe(userId);
    const { event } = await createEventWithNotification(teamId, userId);
    const webPush = new FakeWebPushProvider();
    webPush.nextResult = { ok: false, shouldRemoveSubscription: true, error: 'HTTP 410: gone' };

    await deliverPushNotifications(app.prisma, event, webPush, DAYTIME);

    const stillExists = await app.prisma.pushSubscription.findUnique({
      where: { id: subscription.id },
    });
    expect(stillExists).toBeNull();
  });

  it('does nothing at all when the provider is not configured', async () => {
    const { teamId, userId } = await setUpTeam();
    await subscribe(userId);
    const { event } = await createEventWithNotification(teamId, userId);
    const webPush = new FakeWebPushProvider();
    webPush.isConfigured = false;

    await deliverPushNotifications(app.prisma, event, webPush, DAYTIME);

    expect(webPush.sent).toHaveLength(0);
  });
});
