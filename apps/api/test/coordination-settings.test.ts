import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { generateSessionToken, hashSecret } from '../src/lib/crypto';

describe('coordination settings', () => {
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
        adminPhone: `+1555140${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const teamBody = teamResponse.json();
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);
    return { adminToken: teamBody.sessionToken as string, teamId: teamBody.team.id as string };
  }

  async function addParent(teamId: string) {
    const parent = await app.prisma.user.create({
      data: {
        name: 'Avi Levi',
        phone: `+1555141${Math.floor(Math.random() * 9000 + 1000)}`,
        teamMemberships: { create: { teamId, role: 'parent' } },
      },
    });
    createdUserIds.push(parent.id);
    const rawToken = generateSessionToken();
    await app.prisma.session.create({
      data: {
        userId: parent.id,
        tokenHash: hashSecret(rawToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    return rawToken;
  }

  it('returns documented defaults for a team with no stored settings', async () => {
    const { adminToken, teamId } = await setUpTeam();

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/coordination-settings`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      teamId,
      swapExpiryHours: 24,
      reminderOffsetMinutes: [1440, 120],
      escalationLeadMinutes: 120,
    });
  });

  it('lets an admin update the settings and persists them', async () => {
    const { adminToken, teamId } = await setUpTeam();

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/coordination-settings`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { swapExpiryHours: 48, reminderOffsetMinutes: [720, 60], escalationLeadMinutes: 90 },
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json()).toMatchObject({
      swapExpiryHours: 48,
      reminderOffsetMinutes: [720, 60],
      escalationLeadMinutes: 90,
    });

    const getResponse = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/coordination-settings`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(getResponse.json()).toMatchObject({ swapExpiryHours: 48 });

    const auditEntries = await app.prisma.auditLog.findMany({
      where: { teamId, actionType: 'coordination_settings_updated' },
    });
    expect(auditEntries).toHaveLength(1);
  });

  it('rejects an escalation lead time at or below the fixed 60-minute admin alert', async () => {
    const { adminToken, teamId } = await setUpTeam();

    const response = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/coordination-settings`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { swapExpiryHours: 24, reminderOffsetMinutes: [120], escalationLeadMinutes: 60 },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an unauthenticated update', async () => {
    const { teamId } = await setUpTeam();

    const response = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/coordination-settings`,
      headers: { authorization: 'Bearer not-a-real-token' },
      payload: { swapExpiryHours: 24, reminderOffsetMinutes: [120], escalationLeadMinutes: 90 },
    });

    expect(response.statusCode).toBe(401);
  });

  it('lets a non-admin parent view but not update the settings', async () => {
    const { teamId } = await setUpTeam();
    const parentToken = await addParent(teamId);

    const getResponse = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/coordination-settings`,
      headers: { authorization: `Bearer ${parentToken}` },
    });
    expect(getResponse.statusCode).toBe(200);

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/coordination-settings`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload: { swapExpiryHours: 24, reminderOffsetMinutes: [120], escalationLeadMinutes: 90 },
    });
    expect(patchResponse.statusCode).toBe(403);
  });
});
