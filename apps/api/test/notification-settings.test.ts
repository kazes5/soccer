import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { generateSessionToken, hashSecret } from '../src/lib/crypto';

describe('team notification settings', () => {
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
        adminPhone: `+1555150${Math.floor(Math.random() * 9000 + 1000)}`,
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
        phone: `+1555151${Math.floor(Math.random() * 9000 + 1000)}`,
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

  it('returns the documented default quiet-hours window for a team with no stored settings', async () => {
    const { adminToken, teamId } = await setUpTeam();

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/notification-settings`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ teamId, quietHoursStart: '22:00', quietHoursEnd: '07:00' });
  });

  it('lets an admin update the default quiet hours and persists them', async () => {
    const { adminToken, teamId } = await setUpTeam();

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/notification-settings`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { quietHoursStart: '21:30', quietHoursEnd: '06:30' },
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json()).toMatchObject({
      quietHoursStart: '21:30',
      quietHoursEnd: '06:30',
    });

    const auditEntries = await app.prisma.auditLog.findMany({
      where: { teamId, actionType: 'notification_settings_updated' },
    });
    expect(auditEntries).toHaveLength(1);
  });

  it('rejects an invalid time format', async () => {
    const { adminToken, teamId } = await setUpTeam();

    const response = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/notification-settings`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { quietHoursStart: '9:30 PM', quietHoursEnd: '06:30' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('lets a non-admin parent view but not update the settings', async () => {
    const { teamId } = await setUpTeam();
    const parentToken = await addParent(teamId);

    const getResponse = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/notification-settings`,
      headers: { authorization: `Bearer ${parentToken}` },
    });
    expect(getResponse.statusCode).toBe(200);

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/notification-settings`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload: { quietHoursStart: '21:30', quietHoursEnd: '06:30' },
    });
    expect(patchResponse.statusCode).toBe(403);
  });
});
