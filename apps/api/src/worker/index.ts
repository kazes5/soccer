import { PrismaPg } from '@prisma/adapter-pg';
import { Worker } from 'bullmq';
import { PrismaClient } from '../../generated/prisma/client';
import { env } from '../env';
import {
  createOutboxQueue,
  createScheduledTaskQueue,
  OUTBOX_QUEUE_NAME,
  SCHEDULED_TASK_QUEUE_NAME,
} from '../lib/queues';
import { createRedisConnection } from '../lib/redis';
import { processOutboxEvent } from './processors/outbox';
import { processScheduledTask } from './processors/scheduled-task';
import { reconcile } from './reconcile';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const outboxQueue = createOutboxQueue(createRedisConnection());
  const scheduledTaskQueue = createScheduledTaskQueue(createRedisConnection());

  const counts = await reconcile(prisma, outboxQueue, scheduledTaskQueue);
  console.log(
    `[worker] Reconciled ${counts.outboxEvents} outbox event(s), ${counts.scheduledTasks} scheduled task(s).`,
  );

  const outboxWorker = new Worker<{ outboxEventId: string }>(
    OUTBOX_QUEUE_NAME,
    async (job) => {
      try {
        await processOutboxEvent(prisma, job.data.outboxEventId);
      } catch (error) {
        await prisma.outboxEvent
          .update({
            where: { id: job.data.outboxEventId },
            data: {
              attempts: { increment: 1 },
              lastError: error instanceof Error ? error.message : String(error),
            },
          })
          .catch(() => {
            // The event may already be gone (team deleted, cascade); the
            // BullMQ retry/backoff below is what actually matters here.
          });
        throw error;
      }
    },
    { connection: createRedisConnection() },
  );

  const scheduledTaskWorker = new Worker<{ scheduledTaskId: string }>(
    SCHEDULED_TASK_QUEUE_NAME,
    async (job) => {
      try {
        await processScheduledTask(prisma, job.data.scheduledTaskId);
      } catch (error) {
        await prisma.scheduledTask
          .update({
            where: { id: job.data.scheduledTaskId },
            data: {
              attempts: { increment: 1 },
              lastError: error instanceof Error ? error.message : String(error),
            },
          })
          .catch(() => {});
        throw error;
      }
    },
    { connection: createRedisConnection() },
  );

  outboxWorker.on('failed', (job, error) => {
    console.error(`[worker] Outbox job ${job?.id} failed (attempt ${job?.attemptsMade}):`, error);
  });
  scheduledTaskWorker.on('failed', (job, error) => {
    console.error(
      `[worker] Scheduled-task job ${job?.id} failed (attempt ${job?.attemptsMade}):`,
      error,
    );
  });

  console.log('[worker] Listening for outbox events and scheduled tasks...');

  const shutdown = async () => {
    console.log('[worker] Shutting down...');
    await Promise.all([
      outboxWorker.close(),
      scheduledTaskWorker.close(),
      outboxQueue.close(),
      scheduledTaskQueue.close(),
      prisma.$disconnect(),
    ]);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  console.error('[worker] Fatal error during startup:', error);
  process.exit(1);
});
