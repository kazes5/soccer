import type { PrismaClient } from '../../generated/prisma/client';
import {
  createOutboxQueue,
  createScheduledTaskQueue,
  enqueueOutboxEvent,
  enqueueScheduledTask,
} from '../lib/queues';

/**
 * Runs once at startup. Any `OutboxEvent`/`ScheduledTask` row without a
 * terminal timestamp gets (re-)enqueued — the deterministic `jobId` (the
 * row's own id) makes this a no-op for anything already pending or active,
 * so this is what makes the worker safe to crash and restart at any point
 * without an operator having to reason about where it was (ADR 0001).
 *
 * Kept in its own module, separate from `index.ts` (the actual entrypoint,
 * which runs `main()` as a side effect of being loaded) so tests can import
 * this function without accidentally starting a second, real worker.
 */
export async function reconcile(
  prisma: PrismaClient,
  outboxQueue: ReturnType<typeof createOutboxQueue>,
  scheduledTaskQueue: ReturnType<typeof createScheduledTaskQueue>,
): Promise<{ outboxEvents: number; scheduledTasks: number }> {
  const pendingEvents = await prisma.outboxEvent.findMany({
    where: { processedAt: null },
    select: { id: true },
  });
  for (const event of pendingEvents) {
    await enqueueOutboxEvent(outboxQueue, event.id);
  }

  const pendingTasks = await prisma.scheduledTask.findMany({
    where: { completedAt: null, cancelledAt: null },
    select: { id: true, runAt: true },
  });
  for (const task of pendingTasks) {
    await enqueueScheduledTask(scheduledTaskQueue, task.id, task.runAt);
  }

  return { outboxEvents: pendingEvents.length, scheduledTasks: pendingTasks.length };
}
