import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Prisma } from '../generated/prisma/client';
import type { EmailMessage, EmailProvider } from '../src/lib/email';
import { deliverReminderEmail } from '../src/lib/email-delivery';

/** Records sends in memory, optionally failing — no Brevo account needed. */
class FakeEmailProvider implements EmailProvider {
  isConfigured = true;
  sent: EmailMessage[] = [];
  failWith: Error | null = null;

  async send(message: EmailMessage): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
  }
}

const REMINDER_PAYLOAD = {
  shiftId: 'shift-1',
  sessionId: 'session-1',
  pointId: 'point-1',
  pointName: 'Oak St',
  direction: 'to_practice',
  // 15:30 UTC is 17:30 in Asia/Jerusalem — after DST ends (Oct 25 in 2026),
  // so UTC+2. The email shows the team's local time, not UTC.
  sessionStartsAt: '2026-10-28T15:30:00.000Z',
  fieldLocation: 'Central Field',
  playerNames: ['Yossi Levi', 'Alon Cohen'],
};

describe('deliverReminderEmail', () => {
  const app = buildApp();
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  async function setUp(options: { email?: string | null; language?: 'en' | 'he' } = {}) {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPassword: 'Cedar-River!Otter-52',
        adminPasswordConfirmation: 'Cedar-River!Otter-52',
        adminPhone: `+1555250${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const body = teamResponse.json();
    createdTeamIds.push(body.team.id);
    createdUserIds.push(body.admin.id);
    const teamId = body.team.id as string;
    const userId = body.admin.id as string;
    const email =
      options.email === undefined
        ? `dana-${Math.random().toString(36).slice(2)}@example.com`
        : options.email;
    await app.prisma.user.update({
      where: { id: userId },
      data: { email, languagePreference: options.language ?? 'en' },
    });

    const payload = REMINDER_PAYLOAD as Prisma.InputJsonValue;
    const event = await app.prisma.outboxEvent.create({
      data: {
        teamId,
        eventType: 'shift_reminder',
        category: 'reminders',
        recipientScope: 'self',
        selfUserId: userId,
        payload,
      },
    });
    const notification = await app.prisma.userNotification.create({
      data: {
        outboxEventId: event.id,
        userId,
        teamId,
        eventType: 'shift_reminder',
        category: 'reminders',
        payload,
      },
    });
    return { teamId, userId, email, event, notification };
  }

  it('emails the reminder with the shift details and records the delivery', async () => {
    const { email: address, event, notification } = await setUp();
    const email = new FakeEmailProvider();

    await deliverReminderEmail(app.prisma, event, email);

    expect(email.sent).toHaveLength(1);
    const [message] = email.sent;
    expect(message!.to).toEqual({ email: address, name: 'Dana Cohen' });
    expect(message!.subject).toContain('U-12 Wildcats');
    expect(message!.subject).toContain('To practice');
    expect(message!.text).toContain('Oak St');
    expect(message!.text).toContain('Central Field');
    expect(message!.text).toContain('Yossi Levi, Alon Cohen');
    expect(message!.text).toContain('17:30');
    expect(message!.text).toContain(
      `/schedule?team=${event.teamId}&session=session-1&shift=shift-1`,
    );

    const delivery = await app.prisma.notificationDelivery.findUniqueOrThrow({
      where: {
        userNotificationId_channel: { userNotificationId: notification.id, channel: 'email' },
      },
    });
    expect(delivery.deliveredAt).not.toBeNull();
    expect(delivery.lastError).toBeNull();
  });

  it("writes the email in the parent's language", async () => {
    const { event } = await setUp({ language: 'he' });
    const email = new FakeEmailProvider();

    await deliverReminderEmail(app.prisma, event, email);

    expect(email.sent[0]!.text).toContain('נקודת איסוף: Oak St');
  });

  it('never sends the same reminder twice', async () => {
    const { event } = await setUp();
    const email = new FakeEmailProvider();

    await deliverReminderEmail(app.prisma, event, email);
    await deliverReminderEmail(app.prisma, event, email);

    expect(email.sent).toHaveLength(1);
  });

  it('skips a parent who turned reminder emails off for this team', async () => {
    const { teamId, userId, event } = await setUp();
    await app.prisma.notificationPreference.create({
      data: { userId, teamId, category: 'reminders', channel: 'email', enabled: false },
    });
    const email = new FakeEmailProvider();

    await deliverReminderEmail(app.prisma, event, email);

    expect(email.sent).toHaveLength(0);
  });

  it('skips a parent with no email address', async () => {
    const { event } = await setUp({ email: null });
    const email = new FakeEmailProvider();

    await deliverReminderEmail(app.prisma, event, email);

    expect(email.sent).toHaveLength(0);
  });

  it('only emails reminders, not other notifications', async () => {
    const { event } = await setUp();
    const email = new FakeEmailProvider();

    await deliverReminderEmail(app.prisma, { ...event, eventType: 'shift_claimed' }, email);

    expect(email.sent).toHaveLength(0);
  });

  it('records a failed send without throwing, and a retry can still deliver it', async () => {
    const { event, notification } = await setUp();
    const email = new FakeEmailProvider();
    email.failWith = new Error('Brevo send failed (401): unauthorized');

    await expect(deliverReminderEmail(app.prisma, event, email)).resolves.toBeUndefined();
    const failed = await app.prisma.notificationDelivery.findUniqueOrThrow({
      where: {
        userNotificationId_channel: { userNotificationId: notification.id, channel: 'email' },
      },
    });
    expect(failed).toMatchObject({ deliveredAt: null, attempts: 1 });
    expect(failed.lastError).toContain('401');

    email.failWith = null;
    await deliverReminderEmail(app.prisma, event, email);
    expect(email.sent).toHaveLength(1);
  });

  it('does nothing when email is not configured', async () => {
    const { event } = await setUp();
    const email = new FakeEmailProvider();
    email.isConfigured = false;

    await deliverReminderEmail(app.prisma, event, email);

    expect(email.sent).toHaveLength(0);
  });
});
