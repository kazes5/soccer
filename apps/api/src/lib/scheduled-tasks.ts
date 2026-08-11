import type { Prisma, PrismaClient, ScheduledTaskType } from '../../generated/prisma/client';

export interface RecordScheduledTaskInput {
  teamId: string;
  type: ScheduledTaskType;
  payload: Prisma.InputJsonValue;
  runAt: Date;
}

/**
 * Writes one `ScheduledTask` row — call this inside the same transaction as
 * whatever creates or changes the assignment/session/team-setting the task
 * depends on. Nothing calls this yet: no concrete task type has real
 * business logic until reminders (Checkpoint 9) and escalation (Checkpoint
 * 10) land; this checkpoint only proves the schedule -> delayed job ->
 * processor -> `completedAt` plumbing is correct.
 */
export function recordScheduledTask(
  db: PrismaClient | Prisma.TransactionClient,
  input: RecordScheduledTaskInput,
) {
  return db.scheduledTask.create({
    data: {
      teamId: input.teamId,
      type: input.type,
      payload: input.payload,
      runAt: input.runAt,
    },
  });
}
