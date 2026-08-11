import type { ConnectionOptions } from 'bullmq';
import { Queue } from 'bullmq';
import type IORedis from 'ioredis';

export const OUTBOX_QUEUE_NAME = 'outbox-events';
export const SCHEDULED_TASK_QUEUE_NAME = 'scheduled-tasks';

/**
 * Shared BullMQ job options: a deterministic `jobId` (the outbox/scheduled-
 * task row's own id) makes re-enqueuing the same row a no-op while a job for
 * it is still pending/active — the reconciliation-on-restart safety net in
 * ADR 0001 relies on this. Retries are exponential-backoff per BullMQ's own
 * idempotent-jobs guidance (https://docs.bullmq.io/patterns/idempotent-jobs);
 * the processor itself is also idempotent (checks `processedAt`/`completedAt`
 * before doing any work), so a duplicate or out-of-order delivery of the same
 * job is harmless either way — this is defense in depth, not the only guard.
 */
const RETRY_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2000 },
  // Keep a short window of completed/failed jobs instead of removing them
  // immediately — if the API's best-effort post-commit enqueue and the
  // worker's reconciliation both race to add the same jobId moments apart,
  // an immediately-removed completed job would let the second add() create
  // a genuine duplicate instead of being recognized as a no-op.
  removeOnComplete: { age: 3600 },
  removeOnFail: { age: 86400 },
};

export function createOutboxQueue(connection: IORedis): Queue<{ outboxEventId: string }> {
  return new Queue(OUTBOX_QUEUE_NAME, { connection: connection as ConnectionOptions });
}

export function createScheduledTaskQueue(connection: IORedis): Queue<{ scheduledTaskId: string }> {
  return new Queue(SCHEDULED_TASK_QUEUE_NAME, { connection: connection as ConnectionOptions });
}

export function enqueueOutboxEvent(queue: Queue<{ outboxEventId: string }>, outboxEventId: string) {
  return queue.add('process', { outboxEventId }, { jobId: outboxEventId, ...RETRY_OPTIONS });
}

export function enqueueScheduledTask(
  queue: Queue<{ scheduledTaskId: string }>,
  scheduledTaskId: string,
  runAt: Date,
) {
  const delay = Math.max(0, runAt.getTime() - Date.now());
  return queue.add('run', { scheduledTaskId }, { jobId: scheduledTaskId, delay, ...RETRY_OPTIONS });
}
