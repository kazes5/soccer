import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { generateSessionToken, hashSecret } from '../src/lib/crypto';
import { processOutboxEvent } from '../src/worker/processors/outbox';

describe('notifications', () => {
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
        adminPhone: `+1555200${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const teamBody = teamResponse.json();
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);
    return { adminToken: teamBody.sessionToken as string, teamId: teamBody.team.id as string };
  }

  /** Creates and fully processes N team_broadcast outbox events, so every
   * team member (here: just the admin) ends up with N real UserNotification
   * rows — the fastest real path to notification data without going through
   * a real BullMQ round trip (already covered by worker.test.ts). */
  async function seedNotifications(teamId: string, count: number) {
    for (let i = 0; i < count; i += 1) {
      const event = await app.prisma.outboxEvent.create({
        data: {
          teamId,
          eventType: 'shift_claimed',
          category: 'shift_changes',
          recipientScope: 'team_broadcast',
          payload: { index: i },
        },
      });
      await processOutboxEvent(app.prisma, event.id);
      // Ensure strictly increasing createdAt so cursor-ordering is deterministic.
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  it('lists the newest notifications first, with the unread count', async () => {
    const { adminToken, teamId } = await setUpTeam();
    await seedNotifications(teamId, 3);

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/notifications`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.notifications).toHaveLength(3);
    expect(body.notifications.map((n: { payload: { index: number } }) => n.payload.index)).toEqual([
      2, 1, 0,
    ]);
    expect(body.unreadCount).toBe(3);
    expect(body.nextCursor).toBeNull();
  });

  it('paginates with a cursor', async () => {
    const { adminToken, teamId } = await setUpTeam();
    await seedNotifications(teamId, 3);

    const firstPage = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/notifications?limit=2`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const firstBody = firstPage.json();
    expect(firstBody.notifications).toHaveLength(2);
    expect(firstBody.nextCursor).not.toBeNull();

    const secondPage = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/notifications?limit=2&cursor=${firstBody.nextCursor}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const secondBody = secondPage.json();
    expect(secondBody.notifications).toHaveLength(1);
    expect(secondBody.nextCursor).toBeNull();

    const allIds = [...firstBody.notifications, ...secondBody.notifications].map(
      (n: { id: string }) => n.id,
    );
    expect(new Set(allIds).size).toBe(3);
  });

  it('GET unread-count matches the list response', async () => {
    const { adminToken, teamId } = await setUpTeam();
    await seedNotifications(teamId, 2);

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/notifications/unread-count`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ count: 2 });
  });

  it('marks a notification read idempotently and decrements the unread count', async () => {
    const { adminToken, teamId } = await setUpTeam();
    await seedNotifications(teamId, 2);
    const list = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/notifications`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const notificationId = list.json().notifications[0].id as string;

    const readResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/notifications/${notificationId}/read`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(readResponse.statusCode).toBe(204);

    const afterFirstRead = await app.prisma.userNotification.findUniqueOrThrow({
      where: { id: notificationId },
    });
    expect(afterFirstRead.readAt).not.toBeNull();

    // Second call must not throw and must not move readAt.
    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/notifications/${notificationId}/read`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const afterSecondRead = await app.prisma.userNotification.findUniqueOrThrow({
      where: { id: notificationId },
    });
    expect(afterSecondRead.readAt?.getTime()).toBe(afterFirstRead.readAt?.getTime());

    const countResponse = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/notifications/unread-count`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(countResponse.json()).toEqual({ count: 1 });
  });

  it('dismissing a notification removes it from the list and the unread count', async () => {
    const { adminToken, teamId } = await setUpTeam();
    await seedNotifications(teamId, 2);
    const list = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/notifications`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const notificationId = list.json().notifications[0].id as string;

    const dismissResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/notifications/${notificationId}/dismiss`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(dismissResponse.statusCode).toBe(204);

    const afterDismiss = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/notifications`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const body = afterDismiss.json();
    expect(body.notifications.map((n: { id: string }) => n.id)).not.toContain(notificationId);
    expect(body.unreadCount).toBe(1);
  });

  it('read-all marks every unread notification as read without dismissing them', async () => {
    const { adminToken, teamId } = await setUpTeam();
    await seedNotifications(teamId, 3);

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/notifications/read-all`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(204);

    const afterReadAll = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/notifications`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const body = afterReadAll.json();
    expect(body.notifications).toHaveLength(3);
    expect(body.unreadCount).toBe(0);
    expect(body.notifications.every((n: { readAt: string | null }) => n.readAt !== null)).toBe(
      true,
    );
  });

  it('rejects a caller who is not a member of the team', async () => {
    const { adminToken: ownerToken, teamId } = await setUpTeam();
    const { adminToken: otherTeamToken } = await setUpTeam();
    await seedNotifications(teamId, 1);
    const list = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/notifications`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const notificationId = list.json().notifications[0].id as string;

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/notifications/${notificationId}/read`,
      headers: { authorization: `Bearer ${otherTeamToken}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it("404s reading a teammate's notification (not just anyone's) to avoid leaking its existence", async () => {
    const { adminToken, teamId } = await setUpTeam();
    const parent = await app.prisma.user.create({
      data: {
        name: 'Avi Levi',
        phone: `+1555201${Math.floor(Math.random() * 9000 + 1000)}`,
        teamMemberships: { create: { teamId, role: 'parent' } },
      },
    });
    createdUserIds.push(parent.id);
    const parentToken = generateSessionToken();
    await app.prisma.session.create({
      data: {
        userId: parent.id,
        tokenHash: hashSecret(parentToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    // Both the admin and the parent get their own notification from the
    // same team_broadcast event; the parent must not be able to read the
    // admin's copy by id, even though they're on the same team.
    await seedNotifications(teamId, 1);
    const adminList = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/notifications`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const adminNotificationId = adminList.json().notifications[0].id as string;

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/notifications/${adminNotificationId}/read`,
      headers: { authorization: `Bearer ${parentToken}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('rejects an unauthenticated caller', async () => {
    const { teamId } = await setUpTeam();

    const response = await app.inject({ method: 'GET', url: `/teams/${teamId}/notifications` });

    expect(response.statusCode).toBe(401);
  });
});
