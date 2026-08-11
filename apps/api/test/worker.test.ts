import { Worker } from 'bullmq';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import {
  createOutboxQueue,
  createScheduledTaskQueue,
  enqueueOutboxEvent,
  OUTBOX_QUEUE_NAME,
} from '../src/lib/queues';
import { createRedisConnection } from '../src/lib/redis';
import { processOutboxEvent } from '../src/worker/processors/outbox';
import { reconcile } from '../src/worker/reconcile';

describe('worker queue plumbing', () => {
  const app = buildApp();
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];
  const openConnections: ReturnType<typeof createRedisConnection>[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;

    await Promise.all(openConnections.map((connection) => connection.quit()));
    openConnections.length = 0;
  });

  function redisConnection() {
    const connection = createRedisConnection();
    openConnections.push(connection);
    return connection;
  }

  async function setUpTeam() {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPhone: `+1555190${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const teamBody = teamResponse.json();
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);
    return { teamId: teamBody.team.id as string, adminId: teamBody.admin.id as string };
  }

  it('enqueuing the same outbox event id twice while pending does not create a duplicate job', async () => {
    const { teamId } = await setUpTeam();
    const queue = createOutboxQueue(redisConnection());
    const event = await app.prisma.outboxEvent.create({
      data: {
        teamId,
        eventType: 'shift_claimed',
        category: 'shift_changes',
        recipientScope: 'self',
        payload: {},
      },
    });

    await enqueueOutboxEvent(queue, event.id);
    await enqueueOutboxEvent(queue, event.id);

    const counts = await queue.getJobCounts('waiting', 'delayed', 'active');
    const total = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0);
    expect(total).toBe(1);

    await queue.close();
  });

  it('reconcile() re-enqueues every unprocessed outbox event and incomplete scheduled task, and only those', async () => {
    const { teamId } = await setUpTeam();
    const outboxQueue = createOutboxQueue(redisConnection());
    const scheduledTaskQueue = createScheduledTaskQueue(redisConnection());

    const pending = await app.prisma.outboxEvent.create({
      data: {
        teamId,
        eventType: 'shift_claimed',
        category: 'shift_changes',
        recipientScope: 'self',
        payload: {},
      },
    });
    const alreadyProcessed = await app.prisma.outboxEvent.create({
      data: {
        teamId,
        eventType: 'shift_claimed',
        category: 'shift_changes',
        recipientScope: 'self',
        payload: {},
        processedAt: new Date(),
      },
    });
    const pendingTask = await app.prisma.scheduledTask.create({
      data: { teamId, type: 'reminder', payload: {}, runAt: new Date(Date.now() + 60_000) },
    });
    const cancelledTask = await app.prisma.scheduledTask.create({
      data: { teamId, type: 'reminder', payload: {}, runAt: new Date(), cancelledAt: new Date() },
    });

    const counts = await reconcile(app.prisma, outboxQueue, scheduledTaskQueue);

    // reconcile() is deliberately global, not team-scoped (it runs once for
    // the whole system at worker startup) — other tests running against the
    // same shared dev database may have their own unprocessed rows in flight
    // concurrently, so assert on this test's own specific ids rather than an
    // exact total count.
    expect(counts.outboxEvents).toBeGreaterThanOrEqual(1);
    expect(counts.scheduledTasks).toBeGreaterThanOrEqual(1);
    expect(await outboxQueue.getJob(pending.id)).toBeDefined();
    expect(await outboxQueue.getJob(alreadyProcessed.id)).toBeUndefined();
    expect(await scheduledTaskQueue.getJob(pendingTask.id)).toBeDefined();
    expect(await scheduledTaskQueue.getJob(cancelledTask.id)).toBeUndefined();

    await outboxQueue.close();
    await scheduledTaskQueue.close();
  });

  it('a real BullMQ Worker consuming an enqueued job fans the event out end to end', async () => {
    const { teamId, adminId } = await setUpTeam();
    const queue = createOutboxQueue(redisConnection());
    const event = await app.prisma.outboxEvent.create({
      data: {
        teamId,
        eventType: 'session_cancelled',
        category: 'shift_changes',
        recipientScope: 'self',
        selfUserId: adminId,
        payload: {},
      },
    });

    const worker = new Worker<{ outboxEventId: string }>(
      OUTBOX_QUEUE_NAME,
      (job) => processOutboxEvent(app.prisma, job.data.outboxEventId),
      { connection: redisConnection() },
    );

    try {
      const completed = new Promise<void>((resolve, reject) => {
        worker.on('completed', (job) => {
          if (job.id === event.id) resolve();
        });
        worker.on('failed', (job, error) => {
          if (job?.id === event.id) reject(error);
        });
      });

      await enqueueOutboxEvent(queue, event.id);
      await completed;

      const notification = await app.prisma.userNotification.findFirst({
        where: { outboxEventId: event.id, userId: adminId },
      });
      expect(notification).not.toBeNull();
    } finally {
      await worker.close();
      await queue.close();
    }
  }, 10_000);

  it('enqueueOutboxEvent revives a job that has exhausted BullMQ retries and landed in a terminal failed state', async () => {
    const { teamId, adminId } = await setUpTeam();
    const queue = createOutboxQueue(redisConnection());
    const event = await app.prisma.outboxEvent.create({
      data: {
        teamId,
        eventType: 'shift_claimed',
        category: 'shift_changes',
        recipientScope: 'self',
        selfUserId: adminId,
        payload: {},
      },
    });

    // Force the job to fail immediately (attempts: 1, no backoff) so it
    // lands in BullMQ's terminal `failed` state without waiting for real
    // retries — bypasses enqueueOutboxEvent's own options deliberately.
    await queue.add('process', { outboxEventId: event.id }, { jobId: event.id, attempts: 1 });

    const failingWorker = new Worker<{ outboxEventId: string }>(
      OUTBOX_QUEUE_NAME,
      () => {
        throw new Error('simulated processing failure');
      },
      { connection: redisConnection() },
    );
    try {
      await new Promise<void>((resolve) => {
        failingWorker.on('failed', (job) => {
          if (job?.id === event.id) resolve();
        });
      });
    } finally {
      await failingWorker.close();
    }

    expect(await (await queue.getJob(event.id))?.getState()).toBe('failed');

    // A plain `queue.add()` with the same jobId here would be silently
    // ignored by BullMQ (the exact bug this wrapper guards against) —
    // verify enqueueOutboxEvent actually revives it instead.
    await enqueueOutboxEvent(queue, event.id);
    expect(await (await queue.getJob(event.id))?.getState()).not.toBe('failed');

    const worker = new Worker<{ outboxEventId: string }>(
      OUTBOX_QUEUE_NAME,
      (job) => processOutboxEvent(app.prisma, job.data.outboxEventId),
      { connection: redisConnection() },
    );
    try {
      const completed = new Promise<void>((resolve, reject) => {
        worker.on('completed', (job) => {
          if (job.id === event.id) resolve();
        });
        worker.on('failed', (job, error) => {
          if (job?.id === event.id) reject(error);
        });
      });
      await completed;
    } finally {
      await worker.close();
    }

    const notification = await app.prisma.userNotification.findFirst({
      where: { outboxEventId: event.id, userId: adminId },
    });
    expect(notification).not.toBeNull();

    await queue.close();
  }, 10_000);
});
