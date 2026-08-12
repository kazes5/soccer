import type IORedis from 'ioredis';
import { QUEUE_PREFIX } from './queues';

/**
 * Mirrors QUEUE_PREFIX's test-isolation rationale in lib/queues.ts — keeps
 * test-run pub/sub traffic off the same channel real dev/prod processes use,
 * so a test's published message can never be observed by a concurrently
 * running dev worker/API pair (or vice versa).
 */
export const NOTIFICATION_FANOUT_CHANNEL = QUEUE_PREFIX
  ? `${QUEUE_PREFIX}:notification-fanout`
  : 'notification-fanout';

export interface NotificationFanoutMessage {
  outboxEventId: string;
  teamId: string;
  userIds: string[];
}

/**
 * Fire-and-forget, same rationale as `enqueueOutboxEventBestEffort`:
 * PostgreSQL (the `UserNotification` rows) is the source of truth, so a
 * dropped pub/sub message only costs latency — the SSE route's own periodic
 * poll (see `fetchNotificationsSince`) still catches up within its interval.
 */
export function publishNotificationFanoutBestEffort(
  publisher: IORedis,
  message: NotificationFanoutMessage,
): void {
  void publisher.publish(NOTIFICATION_FANOUT_CHANNEL, JSON.stringify(message)).catch(() => {});
}

/**
 * `subscriber` must be a connection dedicated to this subscription — once an
 * ioredis connection issues `SUBSCRIBE`, it can't issue other commands, the
 * same constraint BullMQ's own Worker/Queue split already works around in
 * this codebase (see `plugins/queues.ts`).
 */
export function subscribeNotificationFanout(
  subscriber: IORedis,
  onMessage: (message: NotificationFanoutMessage) => void,
): void {
  // Same fire-and-forget rationale as publishNotificationFanoutBestEffort
  // above: a failed SUBSCRIBE (e.g. Redis briefly unreachable at startup)
  // only costs latency, not correctness — ioredis re-subscribes
  // automatically on reconnect, and the SSE route's own periodic poll is
  // the fallback either way. Without this `.catch`, a rejection here is
  // unhandled and can crash the whole process.
  void subscriber.subscribe(NOTIFICATION_FANOUT_CHANNEL).catch(() => {});
  subscriber.on('message', (channel, raw) => {
    if (channel !== NOTIFICATION_FANOUT_CHANNEL) return;
    try {
      onMessage(JSON.parse(raw) as NotificationFanoutMessage);
    } catch {
      // Malformed message: drop it rather than crash the subscriber.
    }
  });
}
