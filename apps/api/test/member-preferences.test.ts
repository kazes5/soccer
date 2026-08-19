import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

describe('member notification preferences', () => {
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
        adminPhone: `+1555160${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const teamBody = teamResponse.json();
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);
    return { adminToken: teamBody.sessionToken as string, teamId: teamBody.team.id as string };
  }

  it('returns all-enabled defaults and no overrides for a member with no stored preferences', async () => {
    const { adminToken, teamId } = await setUpTeam();

    const response = await app.inject({
      method: 'GET',
      url: `/users/me/preferences?teamId=${teamId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      teamId,
      quietHoursStart: null,
      quietHoursEnd: null,
      reminderOffsetMinutes: [],
    });
    expect(body.categoryPreferences).toHaveLength(5);
    expect(body.categoryPreferences.every((p: { enabled: boolean }) => p.enabled === true)).toBe(
      true,
    );
  });

  it('sets and clears a personal quiet-hours override independently of reminder offsets', async () => {
    const { adminToken, teamId } = await setUpTeam();

    const setResponse = await app.inject({
      method: 'PATCH',
      url: '/users/me/preferences',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { teamId, quietHoursStart: '23:00', quietHoursEnd: '06:00' },
    });
    expect(setResponse.statusCode).toBe(200);
    expect(setResponse.json()).toMatchObject({ quietHoursStart: '23:00', quietHoursEnd: '06:00' });

    // Updating only reminderOffsetMinutes must not disturb the quiet-hours
    // override just set above — this is exactly the lost-update hazard the
    // route guards against by re-reading fresh state inside the transaction.
    const offsetsResponse = await app.inject({
      method: 'PATCH',
      url: '/users/me/preferences',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { teamId, reminderOffsetMinutes: [90] },
    });
    expect(offsetsResponse.statusCode).toBe(200);
    expect(offsetsResponse.json()).toMatchObject({
      quietHoursStart: '23:00',
      quietHoursEnd: '06:00',
      reminderOffsetMinutes: [90],
    });

    const clearResponse = await app.inject({
      method: 'PATCH',
      url: '/users/me/preferences',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { teamId, quietHoursStart: null, quietHoursEnd: null },
    });
    expect(clearResponse.statusCode).toBe(200);
    expect(clearResponse.json()).toMatchObject({
      quietHoursStart: null,
      quietHoursEnd: null,
      reminderOffsetMinutes: [90],
    });
  });

  it('toggles a single category off without affecting the others', async () => {
    const { adminToken, teamId } = await setUpTeam();

    const response = await app.inject({
      method: 'PATCH',
      url: '/users/me/preferences',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { teamId, categoryPreferences: [{ category: 'swaps', enabled: false }] },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const swaps = body.categoryPreferences.find(
      (p: { category: string }) => p.category === 'swaps',
    );
    const reminders = body.categoryPreferences.find(
      (p: { category: string }) => p.category === 'reminders',
    );
    expect(swaps).toMatchObject({ enabled: false, channel: 'push' });
    expect(reminders).toMatchObject({ enabled: true, channel: 'push' });

    const auditEntries = await app.prisma.auditLog.findMany({
      where: { teamId, actionType: 'member_notification_preferences_updated' },
    });
    expect(auditEntries).toHaveLength(1);
  });

  it('rejects a request for a team the caller does not belong to', async () => {
    const { adminToken } = await setUpTeam();
    const { teamId: otherTeamId } = await setUpTeam();

    const response = await app.inject({
      method: 'GET',
      url: `/users/me/preferences?teamId=${otherTeamId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const { teamId } = await setUpTeam();

    const response = await app.inject({
      method: 'GET',
      url: `/users/me/preferences?teamId=${teamId}`,
    });

    expect(response.statusCode).toBe(401);
  });
});
