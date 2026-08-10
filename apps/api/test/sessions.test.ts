import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

describe('sessions', () => {
  const app = buildApp();
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  async function setUpTeamWithSession() {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPhone: `+1555150${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const teamBody = teamResponse.json();
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);
    const adminToken = teamBody.sessionToken as string;
    const teamId = teamBody.team.id as string;

    const point = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/collection-points`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Oak St', address: '123 Oak St', type: 'pickup' },
    });
    const pointId = point.json().id as string;

    const templateResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-templates`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        startDate: '2026-08-10',
        defaultTime: '18:00',
        defaultFieldLocation: 'Central Field',
        horizonWeeks: 1,
        collectionPointIds: [pointId],
      },
    });
    void templateResponse;

    const sessionsResponse = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/sessions`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const session = sessionsResponse.json().sessions[0] as {
      id: string;
      points: Array<{ pointId: string }>;
    };

    const playerResponse = await app.prisma.player.create({
      data: { teamId, name: 'Yossi Levi', age: 11 },
    });

    return { adminToken, teamId, pointId, sessionId: session.id, playerId: playerResponse.id };
  }

  it('lets an admin edit a scheduled session', async () => {
    const { adminToken, teamId, sessionId } = await setUpTeamWithSession();

    const response = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { fieldLocation: 'North Field' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().fieldLocation).toBe('North Field');
  });

  it('reports a friendly conflict, not a 500, when an edit collides with another session from the same template', async () => {
    const { adminToken, teamId, sessionId } = await setUpTeamWithSession();

    const sessionsResponse = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/sessions`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const sessions = sessionsResponse.json().sessions as Array<{ id: string; startsAt: string }>;
    const otherSession = sessions.find((s) => s.id !== sessionId);
    expect(otherSession).toBeDefined();

    const response = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { startsAt: otherSession!.startsAt },
    });

    expect(response.statusCode).toBe(409);
  });

  it('cancels a session', async () => {
    const { adminToken, teamId, sessionId } = await setUpTeamWithSession();

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/sessions/${sessionId}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('cancelled');
  });

  it('rejects cancelling an already-cancelled session', async () => {
    const { adminToken, teamId, sessionId } = await setUpTeamWithSession();

    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/sessions/${sessionId}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/sessions/${sessionId}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(409);
  });

  it('rejects editing a cancelled session', async () => {
    const { adminToken, teamId, sessionId } = await setUpTeamWithSession();

    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/sessions/${sessionId}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const response = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { fieldLocation: 'North Field' },
    });

    expect(response.statusCode).toBe(409);
  });

  it("assigns players to a session's collection point", async () => {
    const { adminToken, teamId, sessionId, pointId, playerId } = await setUpTeamWithSession();

    const response = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/sessions/${sessionId}/points/${pointId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { direction: 'to_practice', playerIds: [playerId] },
    });

    expect(response.statusCode).toBe(200);
    const point = response.json().points.find((p: { pointId: string }) => p.pointId === pointId);
    expect(point.playerIds).toEqual([playerId]);
  });

  it('rejects assigning a player from a different team', async () => {
    const { adminToken, teamId, sessionId, pointId } = await setUpTeamWithSession();
    const otherTeam = await setUpTeamWithSession();

    const response = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/sessions/${sessionId}/points/${pointId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { direction: 'to_practice', playerIds: [otherTeam.playerId] },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a non-admin editing a session', async () => {
    const { teamId, sessionId } = await setUpTeamWithSession();

    const response = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/sessions/${sessionId}`,
      headers: { authorization: 'Bearer not-a-real-token' },
      payload: { fieldLocation: 'North Field' },
    });

    expect(response.statusCode).toBe(401);
  });
});
