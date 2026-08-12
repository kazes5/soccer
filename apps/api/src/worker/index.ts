import { PrismaPg } from '@prisma/adapter-pg';
import { Worker } from 'bullmq';
import { PrismaClient } from '../../generated/prisma/client';
import { env } from '../env';
import {
  createOutboxQueue,
  createScheduledTaskQueue,
  OUTBOX_QUEUE_NAME,
  QUEUE_PREFIX,
  SCHEDULED_TASK_QUEUE_NAME,
} from '../lib/queues';
import { createRedisConnection } from '../lib/redis';
import { VapidWebPushProvider } from '../lib/web-push';
import { processOutboxEvent } from './processors/outbox';
import { processScheduledTask } from './processors/scheduled-task';
import { reconcile } from './reconcile';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * Runs `process`, and on failure best-effort records the attempt/error onto
 * the row before rethrowing so BullMQ's own retry/backoff still applies —
 * shared by both workers below, which otherwise differ only in which table
 * they record onto.
 */
async function withAttemptTracking<T>(
  process: () => Promise<T>,
  recordFailure: (message: string) => Promise<unknown>,
): Promise<T> {
  try {
    return await process();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordFailure(message).catch(() => {
      // The row may already be gone (team deleted, cascade); the BullMQ
      // retry/backoff below is what actually matters here.
    });
    throw error;
  }
}

async function main() {
  const outboxQueue = createOutboxQueue(createRedisConnection());
  const scheduledTaskQueue = createScheduledTaskQueue(createRedisConnection());
  const notificationPublisher = createRedisConnection();
  const webPush = new VapidWebPushProvider();
  console.log(
    webPush.isConfigured
      ? '[worker] Browser push delivery is configured.'
      : '[worker] Browser push delivery is disabled (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT not set).',
  );

  const counts = await reconcile(prisma, outboxQueue, scheduledTaskQueue);
  console.log(
    `[worker] Reconciled ${counts.outboxEvents} outbox event(s), ${counts.scheduledTasks} scheduled task(s).`,
  );

  const outboxWorker = new Worker<{ outboxEventId: string }>(
    OUTBOX_QUEUE_NAME,
    (job) =>
      withAttemptTracking(
        () => processOutboxEvent(prisma, job.data.outboxEventId, notificationPublisher, webPush),
        (lastError) =>
          prisma.outboxEvent.update({
            where: { id: job.data.outboxEventId },
            data: { attempts: { increment: 1 }, lastError },
          }),
      ),
    { connection: createRedisConnection(), prefix: QUEUE_PREFIX },
  );

  const scheduledTaskWorker = new Worker<{ scheduledTaskId: string }>(
    SCHEDULED_TASK_QUEUE_NAME,
    (job) =>
      withAttemptTracking(
        () => processScheduledTask(prisma, job.data.scheduledTaskId),
        (lastError) =>
          prisma.scheduledTask.update({
            where: { id: job.data.scheduledTaskId },
            data: { attempts: { increment: 1 }, lastError },
          }),
      ),
    { connection: createRedisConnection(), prefix: QUEUE_PREFIX },
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
      notificationPublisher.quit(),
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
