import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { generateSessionToken, hashSecret } from '../src/lib/crypto';

describe('team member management', () => {
  const app = buildApp();
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  async function setUpTeamWithParent() {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPassword: 'Cedar-River!Otter-52',
        adminPasswordConfirmation: 'Cedar-River!Otter-52',
        adminPhone: `+1555125${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const teamBody = teamResponse.json();
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);
    const adminToken = teamBody.sessionToken as string;
    const teamId = teamBody.team.id as string;

    const addResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/members/parents`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Parent Two',
        phone: `+1555126${Math.floor(Math.random() * 9000 + 1000)}`,
        password: 'Cedar-River!Otter-52',
        passwordConfirmation: 'Cedar-River!Otter-52',
      },
    });
    const parentBody = addResponse.json();
    createdUserIds.push(parentBody.userId);

    const parentToken = generateSessionToken();
    await app.prisma.session.create({
      data: {
        userId: parentBody.userId,
        tokenHash: hashSecret(parentToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return { adminToken, parentToken, teamId, parentUserId: parentBody.userId as string };
  }

  it('lets an admin list team members', async () => {
    const { adminToken, teamId } = await setUpTeamWithParent();

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.members).toHaveLength(2);
    expect(body.members.map((m: { role: string }) => m.role).sort()).toEqual(['admin', 'parent']);
  });

  it('rejects a non-admin listing team members', async () => {
    const { teamId, parentToken } = await setUpTeamWithParent();

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${parentToken}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it('lets a parent list the team roster, ordered by name, without contact details', async () => {
    const { parentToken, teamId } = await setUpTeamWithParent();

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/roster`,
      headers: { authorization: `Bearer ${parentToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.members).toEqual([
      { userId: expect.any(String), name: 'Dana Cohen', role: 'admin' },
      { userId: expect.any(String), name: 'Parent Two', role: 'parent' },
    ]);
    for (const member of body.members) {
      expect(member).not.toHaveProperty('phone');
      expect(member).not.toHaveProperty('email');
    }
  });

  it('rejects an unauthenticated caller listing the team roster', async () => {
    const { teamId } = await setUpTeamWithParent();

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/roster`,
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('promotes a parent to admin', async () => {
    const { adminToken, teamId, parentUserId } = await setUpTeamWithParent();

    const response = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/members/${parentUserId}/role`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: 'admin' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ userId: parentUserId, role: 'admin' });

    const auditEntries = await app.prisma.auditLog.findMany({
      where: { teamId, actionType: 'member_promoted' },
    });
    expect(auditEntries).toHaveLength(1);

    const outboxEvents = await app.prisma.outboxEvent.findMany({
      where: { teamId, eventType: 'member_promoted' },
    });
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]).toMatchObject({
      category: 'admin_changes',
      recipientScope: 'team_broadcast',
    });
    expect(outboxEvents[0]?.payload).toMatchObject({
      userId: parentUserId,
      userName: 'Parent Two',
    });
  });

  it('blocks demoting the last remaining admin', async () => {
    const { adminToken, teamId } = await setUpTeamWithParent();

    const teamResponse = await app.prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      include: { members: true },
    });
    const adminMembership = teamResponse.members.find((m) => m.role === 'admin')!;

    const response = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/members/${adminMembership.userId}/role`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: 'parent' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('blocks removing the last remaining admin', async () => {
    const { adminToken, teamId } = await setUpTeamWithParent();

    const teamResponse = await app.prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      include: { members: true },
    });
    const adminMembership = teamResponse.members.find((m) => m.role === 'admin')!;

    const response = await app.inject({
      method: 'DELETE',
      url: `/teams/${teamId}/members/${adminMembership.userId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(409);
  });

  it('keeps one admin when two admins concurrently try to demote each other', async () => {
    const { adminToken, parentToken, teamId, parentUserId } = await setUpTeamWithParent();
    const originalAdmin = await app.prisma.teamMember.findFirstOrThrow({
      where: { teamId, role: 'admin' },
    });

    const promotion = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/members/${parentUserId}/role`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: 'admin' },
    });
    expect(promotion.statusCode).toBe(200);

    const [first, second] = await Promise.all([
      app.inject({
        method: 'PATCH',
        url: `/teams/${teamId}/members/${parentUserId}/role`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { role: 'parent' },
      }),
      app.inject({
        method: 'PATCH',
        url: `/teams/${teamId}/members/${originalAdmin.userId}/role`,
        headers: { authorization: `Bearer ${parentToken}` },
        payload: { role: 'parent' },
      }),
    ]);

    const statusCodes = [first.statusCode, second.statusCode];
    expect(statusCodes.filter((status) => status === 200)).toHaveLength(1);
    expect(statusCodes.every((status) => [200, 403, 409].includes(status))).toBe(true);
    expect(await app.prisma.teamMember.count({ where: { teamId, role: 'admin' } })).toBe(1);
  });

  it('removes a parent, revokes their login, and preserves their audit trail', async () => {
    const { adminToken, teamId, parentUserId } = await setUpTeamWithParent();

    const response = await app.inject({
      method: 'DELETE',
      url: `/teams/${teamId}/members/${parentUserId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(204);

    const membership = await app.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: parentUserId } },
    });
    expect(membership).toBeNull();

    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: parentUserId } });
    expect(user.isActive).toBe(false);

    const auditEntries = await app.prisma.auditLog.findMany({
      where: { teamId, actionType: 'member_removed', targetId: parentUserId },
    });
    expect(auditEntries).toHaveLength(1);

    const outboxEvents = await app.prisma.outboxEvent.findMany({
      where: { teamId, eventType: 'member_removed' },
    });
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]?.payload).toMatchObject({
      userId: parentUserId,
      userName: 'Parent Two',
    });
  });

  it("reopens a removed member's future shift while preserving their past assignment", async () => {
    const { adminToken, parentToken, teamId, parentUserId } = await setUpTeamWithParent();

    const point = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/collection-points`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Oak St', address: '123 Oak St', type: 'pickup' },
    });
    const futureSession = await app.prisma.practiceSession.create({
      data: {
        teamId,
        startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        fieldLocation: 'Central Field',
        status: 'scheduled',
      },
    });
    const futureShift = await app.prisma.shift.create({
      data: {
        sessionId: futureSession.id,
        pointId: point.json().id,
        direction: 'to_practice',
        status: 'open',
      },
    });
    const shiftId = futureShift.id;

    const pastSession = await app.prisma.practiceSession.create({
      data: {
        teamId,
        startsAt: new Date('2026-01-01T18:00:00.000Z'),
        fieldLocation: 'Old Field',
        status: 'scheduled',
      },
    });
    const pastShift = await app.prisma.shift.create({
      data: {
        sessionId: pastSession.id,
        pointId: point.json().id,
        direction: 'to_practice',
        status: 'claimed',
        assignedUserId: parentUserId,
      },
    });

    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/claim`,
      headers: { authorization: `Bearer ${parentToken}` },
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/teams/${teamId}/members/${parentUserId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(204);

    const shift = await app.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(shift.status).toBe('open');
    expect(shift.assignedUserId).toBeNull();

    const historicalShift = await app.prisma.shift.findUniqueOrThrow({
      where: { id: pastShift.id },
    });
    expect(historicalShift.status).toBe('claimed');
    expect(historicalShift.assignedUserId).toBe(parentUserId);

    const auditEntries = await app.prisma.auditLog.findMany({
      where: { teamId, actionType: 'shift_released', targetId: shiftId },
    });
    expect(auditEntries).toHaveLength(1);

    const outboxEvents = await app.prisma.outboxEvent.findMany({
      where: { teamId, eventType: 'shift_released' },
    });
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]?.payload).toMatchObject({
      shiftId,
      reason: 'member_removed',
      byUserName: 'Parent Two',
    });
  });

  describe('POST /teams/:teamId/members/parents', () => {
    it('creates a parent with players, and records an audit log entry and broadcast', async () => {
      const { adminToken, teamId } = await setUpTeamWithParent();
      const phone = `+1555127${Math.floor(Math.random() * 9000 + 1000)}`;

      const response = await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/members/parents`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Directly Added Parent',
          phone,
          password: 'Cedar-River!Otter-52',
          passwordConfirmation: 'Cedar-River!Otter-52',
          players: [{ name: 'Directly Added Player', age: 9 }],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toMatchObject({ name: 'Directly Added Parent', phone, role: 'parent' });
      createdUserIds.push(body.userId);

      expect(
        await app.prisma.teamMember.count({
          where: { teamId, userId: body.userId, role: 'parent' },
        }),
      ).toBe(1);
      expect(
        await app.prisma.player.count({
          where: {
            teamId,
            name: 'Directly Added Player',
            parents: { some: { userId: body.userId } },
          },
        }),
      ).toBe(1);

      const auditEntries = await app.prisma.auditLog.findMany({
        where: { teamId, actionType: 'member_added_directly', targetId: body.userId },
      });
      expect(auditEntries).toHaveLength(1);

      const outboxEvents = await app.prisma.outboxEvent.findMany({
        where: {
          teamId,
          eventType: 'member_added_directly',
          payload: { path: ['userId'], equals: body.userId },
        },
      });
      expect(outboxEvents).toHaveLength(1);
      expect(outboxEvents[0]?.payload).toMatchObject({
        userId: body.userId,
        userName: 'Directly Added Parent',
      });

      const login = await app.inject({
        method: 'POST',
        url: '/auth/password/login',
        payload: { identifier: phone, password: 'Cedar-River!Otter-52' },
      });
      expect(login.statusCode).toBe(200);
    });

    it('rejects a non-admin caller', async () => {
      const { teamId, parentToken } = await setUpTeamWithParent();

      const response = await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/members/parents`,
        headers: { authorization: `Bearer ${parentToken}` },
        payload: {
          name: 'Someone',
          phone: `+1555128${Math.floor(Math.random() * 9000 + 1000)}`,
          password: 'Cedar-River!Otter-52',
          passwordConfirmation: 'Cedar-River!Otter-52',
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('rejects a phone/email already active on the team', async () => {
      const { adminToken, teamId } = await setUpTeamWithParent();
      const phone = `+1555129${Math.floor(Math.random() * 9000 + 1000)}`;
      const first = await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/members/parents`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'First',
          phone,
          password: 'Cedar-River!Otter-52',
          passwordConfirmation: 'Cedar-River!Otter-52',
        },
      });
      createdUserIds.push(first.json().userId);

      const duplicate = await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/members/parents`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Second',
          phone,
          password: 'Cedar-River!Otter-52',
          passwordConfirmation: 'Cedar-River!Otter-52',
        },
      });

      expect(duplicate.statusCode).toBe(409);
    });

    it('reactivates a previously-removed user with the same phone instead of erroring', async () => {
      const { adminToken, teamId } = await setUpTeamWithParent();
      const phone = `+1555131${Math.floor(Math.random() * 9000 + 1000)}`;

      const first = await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/members/parents`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Original Name',
          phone,
          password: 'Cedar-River!Otter-52',
          passwordConfirmation: 'Cedar-River!Otter-52',
        },
      });
      const firstUserId = first.json().userId as string;
      createdUserIds.push(firstUserId);

      const removed = await app.inject({
        method: 'DELETE',
        url: `/teams/${teamId}/members/${firstUserId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(removed.statusCode).toBe(204);

      const reactivated = await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/members/parents`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Rejoined Name',
          phone,
          password: 'Willow-Harbor!Finch-81',
          passwordConfirmation: 'Willow-Harbor!Finch-81',
        },
      });

      expect(reactivated.statusCode).toBe(201);
      const body = reactivated.json();
      expect(body.userId).toBe(firstUserId);
      expect(body.name).toBe('Rejoined Name');

      const user = await app.prisma.user.findUniqueOrThrow({ where: { id: firstUserId } });
      expect(user.isActive).toBe(true);
      expect(user.name).toBe('Rejoined Name');

      expect(
        await app.prisma.teamMember.count({
          where: { teamId, userId: firstUserId, role: 'parent' },
        }),
      ).toBe(1);

      const login = await app.inject({
        method: 'POST',
        url: '/auth/password/login',
        payload: { identifier: phone, password: 'Willow-Harbor!Finch-81' },
      });
      expect(login.statusCode).toBe(200);

      const staleLogin = await app.inject({
        method: 'POST',
        url: '/auth/password/login',
        payload: { identifier: phone, password: 'Cedar-River!Otter-52' },
      });
      expect(staleLogin.statusCode).toBe(401);
    });

    it('rejects an unacceptable password', async () => {
      const { adminToken, teamId } = await setUpTeamWithParent();

      const response = await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/members/parents`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Someone',
          phone: `+1555130${Math.floor(Math.random() * 9000 + 1000)}`,
          password: 'too-short-1',
          passwordConfirmation: 'too-short-1',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /teams/:teamId/members/:userId/set-password', () => {
    it("resets a member's password, revokes their other sessions, and records an audit entry", async () => {
      const { adminToken, teamId, parentUserId } = await setUpTeamWithParent();
      const otherSessionToken = generateSessionToken();
      await app.prisma.session.create({
        data: {
          userId: parentUserId,
          tokenHash: hashSecret(otherSessionToken),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/members/${parentUserId}/set-password`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          password: 'Willow-Harbor!Finch-81',
          passwordConfirmation: 'Willow-Harbor!Finch-81',
        },
      });

      expect(response.statusCode).toBe(204);

      const revoked = await app.prisma.session.findFirst({
        where: { tokenHash: hashSecret(otherSessionToken) },
      });
      expect(revoked?.revokedAt).not.toBeNull();

      const auditEntries = await app.prisma.auditLog.findMany({
        where: { actionType: 'password_set_by_admin', targetId: parentUserId },
      });
      expect(auditEntries).toHaveLength(1);

      const user = await app.prisma.user.findUniqueOrThrow({ where: { id: parentUserId } });
      const login = await app.inject({
        method: 'POST',
        url: '/auth/password/login',
        payload: { identifier: user.phone!, password: 'Willow-Harbor!Finch-81' },
      });
      expect(login.statusCode).toBe(200);
    });

    it('rejects a non-admin caller', async () => {
      const { teamId, parentToken, parentUserId } = await setUpTeamWithParent();

      const response = await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/members/${parentUserId}/set-password`,
        headers: { authorization: `Bearer ${parentToken}` },
        payload: {
          password: 'Willow-Harbor!Finch-81',
          passwordConfirmation: 'Willow-Harbor!Finch-81',
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('404s for a user not on this team', async () => {
      const { adminToken, teamId } = await setUpTeamWithParent();
      const other = await setUpTeamWithParent();

      const response = await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/members/${other.parentUserId}/set-password`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          password: 'Willow-Harbor!Finch-81',
          passwordConfirmation: 'Willow-Harbor!Finch-81',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('rejects a mismatched password confirmation', async () => {
      const { adminToken, teamId, parentUserId } = await setUpTeamWithParent();

      const response = await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/members/${parentUserId}/set-password`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { password: 'Willow-Harbor!Finch-81', passwordConfirmation: 'different' },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
