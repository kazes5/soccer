import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

describe('collection points', () => {
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
        adminPhone: `+1555130${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const teamBody = teamResponse.json();
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);
    return { adminToken: teamBody.sessionToken as string, teamId: teamBody.team.id as string };
  }

  it('lets an admin create a collection point', async () => {
    const { adminToken, teamId } = await setUpTeam();

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/collection-points`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Oak St', address: '123 Oak St', type: 'pickup' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ name: 'Oak St', address: '123 Oak St', type: 'pickup', teamId });

    const auditEntries = await app.prisma.auditLog.findMany({
      where: { teamId, actionType: 'collection_point_created' },
    });
    expect(auditEntries).toHaveLength(1);
  });

  it('round-trips GPS coordinates as numbers', async () => {
    const { adminToken, teamId } = await setUpTeam();

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/collection-points`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Downtown Park',
        address: '1 Park Ave',
        type: 'both',
        gpsLat: 32.0853,
        gpsLng: 34.7818,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.gpsLat).toBeCloseTo(32.0853, 4);
    expect(body.gpsLng).toBeCloseTo(34.7818, 4);
  });

  it('rejects a non-admin creating a collection point', async () => {
    const { teamId } = await setUpTeam();

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/collection-points`,
      headers: { authorization: 'Bearer not-a-real-token' },
      payload: { name: 'Oak St', address: '123 Oak St', type: 'pickup' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('lists collection points for the team', async () => {
    const { adminToken, teamId } = await setUpTeam();
    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/collection-points`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Oak St', address: '123 Oak St', type: 'pickup' },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/collection-points`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().points).toHaveLength(1);
  });

  it('updates a collection point', async () => {
    const { adminToken, teamId } = await setUpTeam();
    const created = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/collection-points`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Oak St', address: '123 Oak St', type: 'pickup' },
    });
    const pointId = created.json().id;

    const response = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/collection-points/${pointId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Oak Street', address: '123 Oak St', type: 'both' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: 'Oak Street', type: 'both' });
  });

  it('clears previously-set GPS coordinates when an update omits them', async () => {
    const { adminToken, teamId } = await setUpTeam();
    const created = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/collection-points`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Downtown Park',
        address: '1 Park Ave',
        type: 'both',
        gpsLat: 32.0853,
        gpsLng: 34.7818,
      },
    });
    const pointId = created.json().id;

    const response = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/collection-points/${pointId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Downtown Park', address: '1 Park Ave', type: 'both' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ gpsLat: null, gpsLng: null });
  });

  it('deletes an unused collection point', async () => {
    const { adminToken, teamId } = await setUpTeam();
    const created = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/collection-points`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Oak St', address: '123 Oak St', type: 'pickup' },
    });
    const pointId = created.json().id;

    const response = await app.inject({
      method: 'DELETE',
      url: `/teams/${teamId}/collection-points/${pointId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(204);
  });

  it('blocks deleting a collection point that already has scheduled shifts', async () => {
    const { adminToken, teamId } = await setUpTeam();
    const created = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/collection-points`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Oak St', address: '123 Oak St', type: 'pickup' },
    });
    const pointId = created.json().id;

    await app.inject({
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

    const response = await app.inject({
      method: 'DELETE',
      url: `/teams/${teamId}/collection-points/${pointId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(409);
  });
});
