import { formatDate, translate } from '@soccer/i18n';
import type { OutboxEvent, PrismaClient } from '../../generated/prisma/client';
import { env } from '../env';
import type { EmailProvider } from './email';

function asString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Emails a `shift_reminder` to the parent holding the shift — the one event
 * type sent by email (CLAUDE.md §3.11; team-wide broadcasts stay in-app and
 * push, so ~100 parents don't get an email per change). Runs after the
 * outbox fan-out commits, like push delivery, and is skipped when:
 * - email isn't configured, or the event isn't a reminder;
 * - the parent is inactive or has no email on file;
 * - the parent turned reminder emails off for this team (opt-out, matching
 *   push's model: no `NotificationPreference` row means on).
 *
 * Quiet hours need no check here: the reminder task itself is already
 * deferred out of quiet hours before its event is recorded
 * (worker/processors/scheduled-task.ts).
 *
 * Idempotent through the `email` `NotificationDelivery` row: a delivered row
 * means a retry sends nothing. A failed send is recorded on that row, never
 * thrown — the outbox event is already processed, and email is best-effort
 * next to the in-app record, which always exists.
 */
export async function deliverReminderEmail(
  prisma: PrismaClient,
  event: OutboxEvent,
  email: EmailProvider,
): Promise<void> {
  if (!email.isConfigured || event.eventType !== 'shift_reminder' || !event.selfUserId) return;

  const [user, team, preference, notification] = await Promise.all([
    prisma.user.findUnique({
      where: { id: event.selfUserId },
      select: { name: true, email: true, isActive: true, languagePreference: true },
    }),
    prisma.team.findUnique({ where: { id: event.teamId }, select: { name: true, timezone: true } }),
    prisma.notificationPreference.findUnique({
      where: {
        userId_teamId_category_channel: {
          userId: event.selfUserId,
          teamId: event.teamId,
          category: 'reminders',
          channel: 'email',
        },
      },
    }),
    prisma.userNotification.findUnique({
      where: { outboxEventId_userId: { outboxEventId: event.id, userId: event.selfUserId } },
      include: { deliveries: { where: { channel: 'email' } } },
    }),
  ]);
  if (!user?.isActive || !user.email || !team || !notification) return;
  if (preference?.enabled === false) return;
  if (notification.deliveries.some((delivery) => delivery.deliveredAt)) return;

  const payload = event.payload as Record<string, unknown>;
  const locale = user.languagePreference;
  const sessionId = asString(payload, 'sessionId');
  const shiftId = asString(payload, 'shiftId');
  const startsAt = asString(payload, 'sessionStartsAt');
  const playerNames = Array.isArray(payload.playerNames)
    ? payload.playerNames.filter((name): name is string => typeof name === 'string')
    : [];
  const direction =
    payload.direction === 'to_practice'
      ? translate(locale, 'schedule.toPractice')
      : translate(locale, 'schedule.fromPractice');
  const when = startsAt
    ? formatDate(locale, new Date(startsAt), {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: team.timezone,
      })
    : '';
  const scheduleUrl = `${env.WEB_ORIGIN}/schedule?team=${encodeURIComponent(event.teamId)}&session=${encodeURIComponent(sessionId)}&shift=${encodeURIComponent(shiftId)}`;

  const params = {
    teamName: team.name,
    userName: user.name,
    direction,
    pointName: asString(payload, 'pointName'),
    when,
    fieldLocation: asString(payload, 'fieldLocation'),
    players:
      playerNames.length > 0
        ? playerNames.join(', ')
        : translate(locale, 'email.reminder.noPlayers'),
    scheduleUrl,
  };

  let lastError: string | null = null;
  try {
    await email.send({
      to: { email: user.email, name: user.name },
      subject: translate(locale, 'email.reminder.subject', params),
      text: translate(locale, 'email.reminder.body', params),
    });
  } catch (error) {
    lastError = error instanceof Error ? error.message.slice(0, 500) : 'Email send failed.';
  }

  await prisma.notificationDelivery.upsert({
    where: {
      userNotificationId_channel: { userNotificationId: notification.id, channel: 'email' },
    },
    create: {
      userNotificationId: notification.id,
      channel: 'email',
      attempts: 1,
      lastError,
      deliveredAt: lastError ? null : new Date(),
    },
    update: {
      attempts: { increment: 1 },
      lastError,
      deliveredAt: lastError ? null : new Date(),
    },
  });
}
