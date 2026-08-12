import type { Queue } from 'bullmq';
import type { PrismaClient, ScheduledTask } from '../../../generated/prisma/client';
import { enqueueOutboxEvent } from '../../lib/queues';
import { loadSwapRequestWithRelations, resolveSwapRequestOutcome } from '../../lib/swap-requests';

async function processSwapExpiry(
  prisma: PrismaClient,
  task: ScheduledTask,
  outboxQueue?: Queue<{ outboxEventId: string }>,
): Promise<void> {
  const payload = task.payload as { swapRequestId?: string };
  if (typeof payload.swapRequestId !== 'string') return;

  const existing = await loadSwapRequestWithRelations(prisma, payload.swapRequestId);
  // Already resolved by a human (accept/decline/cancel) before this fired —
  // that path already cancelled this very task, but the delayed BullMQ job
  // can still land moments later; a no-op here is correct either way.
  if (!existing || existing.status !== 'pending') return;

  const outboxEventId = await prisma.$transaction((tx) =>
    resolveSwapRequestOutcome(tx, existing, 'expired', null),
  );

  if (outboxQueue) {
    await enqueueOutboxEvent(outboxQueue, outboxEventId).catch(() => {
      // Best-effort, same reasoning as every other post-commit enqueue in
      // this codebase — the outbox worker's own startup reconciliation
      // picks up any event still missing `processedAt`.
    });
  }
}

/**
 * Idempotent: a no-op if the task is missing, already completed, or
 * cancelled. `swap_expiry` is the only concrete task type with real
 * business logic so far — reminders land in Checkpoint 9, escalation in
 * Checkpoint 10.
 */
export async function processScheduledTask(
  prisma: PrismaClient,
  scheduledTaskId: string,
  outboxQueue?: Queue<{ outboxEventId: string }>,
): Promise<void> {
  const task = await prisma.scheduledTask.findUnique({ where: { id: scheduledTaskId } });
  if (!task || task.completedAt || task.cancelledAt) return;

  if (task.type === 'swap_expiry') {
    await processSwapExpiry(prisma, task, outboxQueue);
  }

  await prisma.scheduledTask.update({
    where: { id: task.id },
    data: { completedAt: new Date() },
  });
}
