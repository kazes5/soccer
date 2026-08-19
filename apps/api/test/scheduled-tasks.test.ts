import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { recordScheduledTask } from '../src/lib/scheduled-tasks';
import { processScheduledTask } from '../src/worker/processors/scheduled-task';

describe('scheduled tasks', () => {
  const app = buildApp();
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  async function setUpTeam() {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPassword: 'Cedar-River!Otter-52',
        adminPasswordConfirmation: 'Cedar-River!Otter-52',
        adminPhone: `+1555180${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const teamBody = teamResponse.json();
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);
    return { teamId: teamBody.team.id as string };
  }

  it('persists a scheduled task with the given type/runAt/payload', async () => {
    const { teamId } = await setUpTeam();
    const runAt = new Date(Date.now() + 60_000);

    const task = await app.prisma.$transaction((tx) =>
      recordScheduledTask(tx, { teamId, type: 'reminder', payload: { shiftId: 'shift-1' }, runAt }),
    );

    expect(task).toMatchObject({
      teamId,
      type: 'reminder',
      payload: { shiftId: 'shift-1' },
      completedAt: null,
      cancelledAt: null,
    });
    expect(task.runAt.getTime()).toBe(runAt.getTime());
  });

  it('marks a pending task completed', async () => {
    const { teamId } = await setUpTeam();
    const task = await app.prisma.scheduledTask.create({
      data: { teamId, type: 'escalation', payload: {}, runAt: new Date() },
    });

    await processScheduledTask(app.prisma, task.id);

    const updated = await app.prisma.scheduledTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.completedAt).not.toBeNull();
  });

  it('is a no-op for an already-completed task', async () => {
    const { teamId } = await setUpTeam();
    const completedAt = new Date(Date.now() - 60_000);
    const task = await app.prisma.scheduledTask.create({
      data: { teamId, type: 'reminder', payload: {}, runAt: new Date(), completedAt },
    });

    await processScheduledTask(app.prisma, task.id);

    const updated = await app.prisma.scheduledTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.completedAt?.getTime()).toBe(completedAt.getTime());
  });

  it('does not complete a cancelled task', async () => {
    const { teamId } = await setUpTeam();
    const task = await app.prisma.scheduledTask.create({
      data: { teamId, type: 'reminder', payload: {}, runAt: new Date(), cancelledAt: new Date() },
    });

    await processScheduledTask(app.prisma, task.id);

    const updated = await app.prisma.scheduledTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.completedAt).toBeNull();
  });

  it('is a no-op when the task no longer exists', async () => {
    await expect(
      processScheduledTask(app.prisma, '00000000-0000-4000-8000-000000000000'),
    ).resolves.toBeUndefined();
  });
});
