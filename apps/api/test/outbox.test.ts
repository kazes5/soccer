import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { recordOutboxEvent } from '../src/lib/outbox';
import { processOutboxEvent } from '../src/worker/processors/outbox';

describe('outbox events', () => {
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
        adminPhone: `+1555170${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const teamBody = teamResponse.json();
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);
    return { teamId: teamBody.team.id as string, adminId: teamBody.admin.id as string };
  }

  async function addParent(teamId: string) {
    const parent = await app.prisma.user.create({
      data: {
        name: 'Avi Levi',
        phone: `+1555171${Math.floor(Math.random() * 9000 + 1000)}`,
        teamMemberships: { create: { teamId, role: 'parent' } },
      },
    });
    createdUserIds.push(parent.id);
    return parent.id;
  }

  describe('recordOutboxEvent', () => {
    it('persists a team_broadcast event with an empty participant list and no self user', async () => {
      const { teamId } = await setUpTeam();

      const event = await app.prisma.$transaction((tx) =>
        recordOutboxEvent(tx, {
          teamId,
          eventType: 'shift_claimed',
          category: 'shift_changes',
          payload: { shiftId: 'shift-1' },
          recipientScope: { type: 'team_broadcast' },
        }),
      );

      expect(event).toMatchObject({
        teamId,
        eventType: 'shift_claimed',
        category: 'shift_changes',
        severity: 'normal',
        recipientScope: 'team_broadcast',
        participantUserIds: [],
        selfUserId: null,
        processedAt: null,
      });
    });

    it('persists a participants event with the given user ids', async () => {
      const { teamId, adminId } = await setUpTeam();
      const parentId = await addParent(teamId);

      const event = await app.prisma.$transaction((tx) =>
        recordOutboxEvent(tx, {
          teamId,
          eventType: 'swap_requested',
          category: 'swaps',
          severity: 'normal',
          payload: {},
          recipientScope: { type: 'participants', userIds: [adminId, parentId] },
        }),
      );

      expect(event.recipientScope).toBe('participants');
      expect(event.participantUserIds).toEqual([adminId, parentId]);
      expect(event.selfUserId).toBeNull();
    });

    it('persists a self event with the given user id', async () => {
      const { teamId, adminId } = await setUpTeam();

      const event = await app.prisma.$transaction((tx) =>
        recordOutboxEvent(tx, {
          teamId,
          eventType: 'reminder_due',
          category: 'reminders',
          payload: {},
          recipientScope: { type: 'self', userId: adminId },
        }),
      );

      expect(event.recipientScope).toBe('self');
      expect(event.selfUserId).toBe(adminId);
      expect(event.participantUserIds).toEqual([]);
    });
  });

  describe('processOutboxEvent', () => {
    it('fans a team_broadcast event out to every team member with an in_app delivery', async () => {
      const { teamId, adminId } = await setUpTeam();
      const parentId = await addParent(teamId);

      const event = await app.prisma.outboxEvent.create({
        data: {
          teamId,
          eventType: 'session_cancelled',
          category: 'shift_changes',
          recipientScope: 'team_broadcast',
          payload: { sessionId: 'session-1' },
        },
      });

      await processOutboxEvent(app.prisma, event.id);

      const notifications = await app.prisma.userNotification.findMany({
        where: { outboxEventId: event.id },
        include: { deliveries: true },
      });
      expect(notifications.map((n) => n.userId).sort()).toEqual([adminId, parentId].sort());
      for (const notification of notifications) {
        expect(notification.deliveries).toHaveLength(1);
        expect(notification.deliveries[0]).toMatchObject({ channel: 'in_app' });
        expect(notification.deliveries[0]?.deliveredAt).not.toBeNull();
      }

      const updated = await app.prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(updated.processedAt).not.toBeNull();
    });

    it('fans a participants event out only to the listed users', async () => {
      const { teamId, adminId } = await setUpTeam();
      const parentId = await addParent(teamId);

      const event = await app.prisma.outboxEvent.create({
        data: {
          teamId,
          eventType: 'swap_requested',
          category: 'swaps',
          recipientScope: 'participants',
          participantUserIds: [adminId],
          payload: {},
        },
      });

      await processOutboxEvent(app.prisma, event.id);

      const notifications = await app.prisma.userNotification.findMany({
        where: { outboxEventId: event.id },
      });
      expect(notifications.map((n) => n.userId)).toEqual([adminId]);
      expect(notifications.map((n) => n.userId)).not.toContain(parentId);
    });

    it('fans a self event out only to that user', async () => {
      const { teamId, adminId } = await setUpTeam();
      await addParent(teamId);

      const event = await app.prisma.outboxEvent.create({
        data: {
          teamId,
          eventType: 'reminder_due',
          category: 'reminders',
          recipientScope: 'self',
          selfUserId: adminId,
          payload: {},
        },
      });

      await processOutboxEvent(app.prisma, event.id);

      const notifications = await app.prisma.userNotification.findMany({
        where: { outboxEventId: event.id },
      });
      expect(notifications.map((n) => n.userId)).toEqual([adminId]);
    });

    it('is a no-op when the event is already processed', async () => {
      const { teamId, adminId } = await setUpTeam();

      const event = await app.prisma.outboxEvent.create({
        data: {
          teamId,
          eventType: 'reminder_due',
          category: 'reminders',
          recipientScope: 'self',
          selfUserId: adminId,
          payload: {},
        },
      });

      await processOutboxEvent(app.prisma, event.id);
      // Second call must not create a duplicate notification or throw.
      await processOutboxEvent(app.prisma, event.id);

      const notifications = await app.prisma.userNotification.findMany({
        where: { outboxEventId: event.id },
      });
      expect(notifications).toHaveLength(1);
    });

    it('is a no-op when the event no longer exists', async () => {
      await expect(
        processOutboxEvent(app.prisma, '00000000-0000-4000-8000-000000000000'),
      ).resolves.toBeUndefined();
    });

    it('recovers cleanly from a partial prior attempt (some recipients already notified)', async () => {
      const { teamId, adminId } = await setUpTeam();
      const parentId = await addParent(teamId);

      const event = await app.prisma.outboxEvent.create({
        data: {
          teamId,
          eventType: 'session_cancelled',
          category: 'shift_changes',
          recipientScope: 'team_broadcast',
          payload: {},
        },
      });

      // Simulate a crash after the admin's notification was written but
      // before the event was marked processed.
      await app.prisma.userNotification.create({
        data: {
          outboxEventId: event.id,
          userId: adminId,
          teamId,
          eventType: event.eventType,
          category: event.category,
          payload: {},
        },
      });

      await processOutboxEvent(app.prisma, event.id);

      const notifications = await app.prisma.userNotification.findMany({
        where: { outboxEventId: event.id },
      });
      expect(notifications.map((n) => n.userId).sort()).toEqual([adminId, parentId].sort());
    });
  });
});
