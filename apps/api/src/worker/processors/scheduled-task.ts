import type { PrismaClient } from '../../../generated/prisma/client';

/**
 * Stub: no concrete task type has real business logic yet (reminders land in
 * Checkpoint 9, escalation in Checkpoint 10) — this only proves the
 * schedule -> delayed job -> processor -> `completedAt` plumbing is correct.
 * Idempotent: a no-op if the task is missing, already completed, or
 * cancelled.
 */
export async function processScheduledTask(
  prisma: PrismaClient,
  scheduledTaskId: string,
): Promise<void> {
  const task = await prisma.scheduledTask.findUnique({ where: { id: scheduledTaskId } });
  if (!task || task.completedAt || task.cancelledAt) return;

  await prisma.scheduledTask.update({
    where: { id: task.id },
    data: { completedAt: new Date() },
  });
}
