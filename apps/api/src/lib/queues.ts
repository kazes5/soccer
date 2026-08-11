import type { ConnectionOptions } from 'bullmq';
import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { env } from '../env';

export const OUTBOX_QUEUE_NAME = 'outbox-events';
export const SCHEDULED_TASK_QUEUE_NAME = 'scheduled-tasks';

/**
 * Every route that writes an `OutboxEvent` also enqueues a real job (see
 * `enqueueOutboxEventBestEffort`) — including in tests, which build a real
 * `buildApp()` against real Redis, matching this project's "no mocking"
 * testing philosophy. Without a distinct namespace, jobs created by test
 * runs (where nothing consumes them, since no test spins up the actual
 * long-running worker process) would otherwise accumulate forever under the
 * same keys real dev/prod jobs use. A test-only key prefix keeps that state
 * fully separate — it starts empty every time and never touches real jobs.
 */
export const QUEUE_PREFIX = env.NODE_ENV === 'test' ? 'test' : undefined;

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
  return new Queue(OUTBOX_QUEUE_NAME, {
    connection: connection as ConnectionOptions,
    prefix: QUEUE_PREFIX,
  });
}

export function createScheduledTaskQueue(connection: IORedis): Queue<{ scheduledTaskId: string }> {
  return new Queue(SCHEDULED_TASK_QUEUE_NAME, {
    connection: connection as ConnectionOptions,
    prefix: QUEUE_PREFIX,
  });
}

/**
 * `queue.add()` with a `jobId` that already exists in Redis — in *any*
 * state, including a terminal `failed` one — is treated by BullMQ as a
 * duplicate and returns the existing job without re-queuing it. A
 * deterministic jobId alone is therefore only a no-op guard for jobs still
 * pending/active; for a job that has exhausted its retries and landed in
 * `failed`, calling `add()` again on worker restart would silently do
 * nothing, leaving the row stuck until `removeOnFail`'s age-based cleanup
 * finally clears the old job hash — up to 24h later, regardless of how many
 * times the worker restarts.
 *
 * This checks the existing job's state first: `retry()` a failed one back
 * onto the wait list, `remove()` a stray completed one (so the caller's
 * fresh `add()` can proceed — this shouldn't normally happen, since a
 * completed job implies the row's own terminal timestamp is already set),
 * and leave anything still pending/active alone. Returns 'failed' or
 * 'completed' if a terminal-state job existed, `null` if absent or still
 * pending/active.
 */
async function terminalStateOf(
  queue: Queue<{ outboxEventId: string } | { scheduledTaskId: string }>,
  jobId: string,
): Promise<'failed' | 'completed' | null> {
  const existing = await queue.getJob(jobId);
  if (!existing) return null;
  const state = await existing.getState();
  if (state === 'failed') {
    await existing.retry('failed');
    return 'failed';
  }
  if (state === 'completed') {
    await existing.remove();
    return 'completed';
  }
  return null;
}

export async function enqueueOutboxEvent(
  queue: Queue<{ outboxEventId: string }>,
  outboxEventId: string,
): Promise<void> {
  const terminalState = await terminalStateOf(queue, outboxEventId);
  if (terminalState === 'failed') return; // retry() above already revived it
  await queue.add('process', { outboxEventId }, { jobId: outboxEventId, ...RETRY_OPTIONS });
}

/**
 * Fire-and-forget enqueue for a route handler to call right after its
 * transaction commits — a pure latency optimization, not a correctness
 * requirement. If this never runs (API restart, a Redis blip) or fails, the
 * worker's own startup reconciliation still picks the row up from Postgres
 * (the source of truth per ADR 0001); a route should never make the caller
 * wait on this or fail the request if it errors.
 */
export function enqueueOutboxEventBestEffort(
  queue: Queue<{ outboxEventId: string }>,
  outboxEventId: string,
): void {
  void enqueueOutboxEvent(queue, outboxEventId).catch(() => {});
}

export async function enqueueScheduledTask(
  queue: Queue<{ scheduledTaskId: string }>,
  scheduledTaskId: string,
  runAt: Date,
): Promise<void> {
  const terminalState = await terminalStateOf(queue, scheduledTaskId);
  if (terminalState === 'failed') return; // retry() above already revived it
  const delay = Math.max(0, runAt.getTime() - Date.now());
  await queue.add('run', { scheduledTaskId }, { jobId: scheduledTaskId, delay, ...RETRY_OPTIONS });
}
