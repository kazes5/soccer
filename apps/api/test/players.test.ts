import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { generateSessionToken, hashSecret } from '../src/lib/crypto';

const PASSWORD = 'Cedar-River!Otter-52';

describe('players', () => {
  const app = buildApp({ systemAdminEnabled: true });
  const disabledSystemAdminApp = buildApp({ systemAdminEnabled: false });
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
        adminPhone: `+1555160${Math.floor(Math.random() * 9000 + 1000)}`,
        adminPassword: PASSWORD,
        adminPasswordConfirmation: PASSWORD,
      },
    });
    const teamBody = teamResponse.json();
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);
    return { adminToken: teamBody.sessionToken as string, teamId: teamBody.team.id as string };
  }

  async function addParent(teamId: string, adminToken: string) {
    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/members/parents`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Avi Levi',
        phone: `+1555161${Math.floor(Math.random() * 9000 + 1000)}`,
        password: PASSWORD,
        passwordConfirmation: PASSWORD,
      },
    });
    const body = response.json() as { userId: string };
    createdUserIds.push(body.userId);
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/password/login',
      payload: { identifier: response.json().phone, password: PASSWORD },
    });
    return { userId: body.userId, sessionToken: loginResponse.json().sessionToken as string };
  }

  async function createSystemAdminToken() {
    const user = await app.prisma.user.create({
      data: {
        name: `System Admin ${randomUUID()}`,
        email: `${randomUUID()}@system.test`,
        normalizedEmail: `${randomUUID()}@system.test`,
        systemRole: 'system_admin',
        passwordCredential: { create: { passwordHash: 'irrelevant-not-used-for-login' } },
      },
    });
    createdUserIds.push(user.id);
    const token = generateSessionToken();
    await app.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashSecret(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    return token;
  }

  it('lists a team roster ordered by name', async () => {
    const { adminToken, teamId } = await setUpTeam();
    await app.prisma.player.createMany({
      data: [
        { teamId, name: 'Yossi Levi', age: 11 },
        { teamId, name: 'Alon Cohen', age: 9 },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/players`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().players).toEqual([
      expect.objectContaining({ name: 'Alon Cohen', age: 9 }),
      expect.objectContaining({ name: 'Yossi Levi', age: 11 }),
    ]);
  });

  it('is readable by a non-admin team member', async () => {
    const { adminToken, teamId } = await setUpTeam();
    const { sessionToken } = await addParent(teamId, adminToken);

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/players`,
      headers: { authorization: `Bearer ${sessionToken}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('rejects a caller who belongs to a different team', async () => {
    const { teamId: teamAId } = await setUpTeam();
    const { adminToken: teamBToken } = await setUpTeam();
    await app.prisma.player.create({ data: { teamId: teamAId, name: 'Someone Else', age: 10 } });

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamAId}/players`,
      headers: { authorization: `Bearer ${teamBToken}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects an unauthenticated caller', async () => {
    const { teamId } = await setUpTeam();

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/players`,
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('lets a team admin create, update, and delete a player', async () => {
    const { adminToken, teamId } = await setUpTeam();

    const created = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/players`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'New Player', age: 10 },
    });
    expect(created.statusCode).toBe(201);
    const playerId = created.json().id as string;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/players/${playerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { age: 11 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: 'New Player', age: 11 });

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/teams/${teamId}/players/${playerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(deleted.statusCode).toBe(204);

    const list = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/players`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(list.json().players).toEqual([]);
  });

  it('rejects a non-admin parent creating a player', async () => {
    const { adminToken, teamId } = await setUpTeam();
    const { sessionToken } = await addParent(teamId, adminToken);

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/players`,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { name: 'New Player' },
    });

    expect(response.statusCode).toBe(403);
  });

  it("rejects a team admin managing a different team's players", async () => {
    const { teamId: teamAId } = await setUpTeam();
    const { adminToken: teamBToken } = await setUpTeam();

    const created = await app.inject({
      method: 'POST',
      url: `/teams/${teamAId}/players`,
      headers: { authorization: `Bearer ${teamBToken}` },
      payload: { name: 'Cross Team Player' },
    });
    expect(created.statusCode).toBe(403);

    const existing = await app.prisma.player.create({
      data: { teamId: teamAId, name: 'Team A Player', age: 10 },
    });
    const updated = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamAId}/players/${existing.id}`,
      headers: { authorization: `Bearer ${teamBToken}` },
      payload: { age: 11 },
    });
    expect(updated.statusCode).toBe(403);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/teams/${teamAId}/players/${existing.id}`,
      headers: { authorization: `Bearer ${teamBToken}` },
    });
    expect(deleted.statusCode).toBe(403);
  });

  it('lets a system admin create, update, and delete a player on any team', async () => {
    const { teamId } = await setUpTeam();
    const systemAdminToken = await createSystemAdminToken();

    const created = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/players`,
      headers: { authorization: `Bearer ${systemAdminToken}` },
      payload: { name: 'System Admin Player', age: 8 },
    });
    expect(created.statusCode).toBe(201);
    const playerId = created.json().id as string;

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/teams/${teamId}/players/${playerId}`,
      headers: { authorization: `Bearer ${systemAdminToken}` },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it('replaces linked parents on update instead of appending to them', async () => {
    const { adminToken, teamId } = await setUpTeam();
    const { userId: firstParentId } = await addParent(teamId, adminToken);
    const { userId: secondParentId } = await addParent(teamId, adminToken);

    const created = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/players`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Linked Player', parentUserIds: [firstParentId] },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().parentUserIds).toEqual([firstParentId]);
    const playerId = created.json().id as string;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/players/${playerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { parentUserIds: [secondParentId] },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().parentUserIds).toEqual([secondParentId]);

    const linkCount = await app.prisma.playerParent.count({ where: { playerId } });
    expect(linkCount).toBe(1);
  });

  it('records player_created, player_updated, and player_deleted audit entries', async () => {
    const { adminToken, teamId } = await setUpTeam();

    const created = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/players`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Audited Player', age: 9 },
    });
    const playerId = created.json().id as string;

    await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/players/${playerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { age: 10 },
    });
    await app.inject({
      method: 'DELETE',
      url: `/teams/${teamId}/players/${playerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    const entries = await app.prisma.auditLog.findMany({
      where: { teamId, targetId: playerId },
      orderBy: { createdAt: 'asc' },
      select: { actionType: true },
    });
    expect(entries).toEqual([
      { actionType: 'player_created' },
      { actionType: 'player_updated' },
      { actionType: 'player_deleted' },
    ]);
  });

  it('rejects a parentUserId that is not a member of the team', async () => {
    const { adminToken, teamId } = await setUpTeam();
    const { adminToken: otherTeamAdminToken, teamId: otherTeamId } = await setUpTeam();
    const { userId: outsiderId } = await addParent(otherTeamId, otherTeamAdminToken);

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/players`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Cross Link Player', parentUserIds: [outsiderId] },
    });

    expect(response.statusCode).toBe(400);
    expect(await app.prisma.player.count({ where: { teamId, name: 'Cross Link Player' } })).toBe(0);
  });

  it('blocks the system-admin fallback while SYSTEM_ADMIN_ENABLED is false, even for an actual system admin', async () => {
    const { teamId } = await setUpTeam();
    const systemAdminToken = await createSystemAdminToken();

    const response = await disabledSystemAdminApp.inject({
      method: 'POST',
      url: `/teams/${teamId}/players`,
      headers: { authorization: `Bearer ${systemAdminToken}` },
      payload: { name: 'Should Not Be Created' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('404s updating or deleting a player that does not belong to the given team', async () => {
    const { teamId: teamAId } = await setUpTeam();
    const { adminToken: teamBAdminToken, teamId: teamBId } = await setUpTeam();
    const playerInTeamA = await app.prisma.player.create({
      data: { teamId: teamAId, name: 'Only In Team A' },
    });

    const updated = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamBId}/players/${playerInTeamA.id}`,
      headers: { authorization: `Bearer ${teamBAdminToken}` },
      payload: { age: 12 },
    });
    expect(updated.statusCode).toBe(404);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/teams/${teamBId}/players/${playerInTeamA.id}`,
      headers: { authorization: `Bearer ${teamBAdminToken}` },
    });
    expect(deleted.statusCode).toBe(404);
  });
});
