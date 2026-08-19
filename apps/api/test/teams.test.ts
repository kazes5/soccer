import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { generateSessionToken, hashSecret } from '../src/lib/crypto';

describe('team routes', () => {
  const app = buildApp();
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  async function createTeam(adminPhone: string, teamName = 'U-12 Wildcats') {
    const response = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName,
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPassword: 'Cedar-River!Otter-52',
        adminPasswordConfirmation: 'Cedar-River!Otter-52',
        adminPhone,
      },
    });
    const body = response.json();
    createdTeamIds.push(body.team.id);
    createdUserIds.push(body.admin.id);
    return { response, body };
  }

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  it('creates a team with its first admin and returns a session token', async () => {
    const { response, body } = await createTeam('+15551230001');

    expect(response.statusCode).toBe(201);
    expect(body.team).toMatchObject({ name: 'U-12 Wildcats', season: 'Fall 2026' });
    expect(body.admin).toMatchObject({ name: 'Dana Cohen', phone: '+15551230001' });
    expect(typeof body.sessionToken).toBe('string');

    const membership = await app.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: body.team.id, userId: body.admin.id } },
    });
    expect(membership?.role).toBe('admin');
  });

  it('rejects a request with no admin contact method', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: { teamName: 'U-12 Wildcats', season: 'Fall 2026', adminName: 'Dana Cohen' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns team metadata to a team member', async () => {
    const { body } = await createTeam('+15551230002');

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${body.team.id}`,
      headers: { authorization: `Bearer ${body.sessionToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: body.team.id,
      name: 'U-12 Wildcats',
      season: 'Fall 2026',
      timezone: 'Asia/Jerusalem',
      primaryColor: null,
    });
  });

  it('does not reveal team metadata without authentication', async () => {
    const { body } = await createTeam('+15551230003');

    const response = await app.inject({ method: 'GET', url: `/teams/${body.team.id}` });

    expect(response.statusCode).toBe(401);
  });

  it('does not reveal team metadata to a member of a different team', async () => {
    const first = await createTeam('+15551230004', 'U-12 Wildcats');
    const second = await createTeam('+15551230005', 'U-11 Strikers');

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${second.body.team.id}`,
      headers: { authorization: `Bearer ${first.body.sessionToken}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).not.toHaveProperty('name');
  });

  describe('PATCH /teams/:teamId/accent-color', () => {
    it('lets a team admin set and clear the accent color, audit-logged', async () => {
      const { body } = await createTeam('+15551230006');

      const setResponse = await app.inject({
        method: 'PATCH',
        url: `/teams/${body.team.id}/accent-color`,
        headers: { authorization: `Bearer ${body.sessionToken}` },
        payload: { primaryColor: 'blue' },
      });
      expect(setResponse.statusCode).toBe(200);
      expect(setResponse.json().primaryColor).toBe('blue');

      const auditEntries = await app.prisma.auditLog.findMany({
        where: { teamId: body.team.id, actionType: 'team_accent_color_updated' },
      });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.beforeState).toEqual({ primaryColor: null });
      expect(auditEntries[0]?.afterState).toEqual({ primaryColor: 'blue' });

      const clearResponse = await app.inject({
        method: 'PATCH',
        url: `/teams/${body.team.id}/accent-color`,
        headers: { authorization: `Bearer ${body.sessionToken}` },
        payload: { primaryColor: null },
      });
      expect(clearResponse.statusCode).toBe(200);
      expect(clearResponse.json().primaryColor).toBeNull();
    });

    it('rejects a non-admin caller', async () => {
      const { body } = await createTeam('+15551230007');
      const parentToken = generateSessionToken();
      const parent = await app.prisma.user.create({
        data: { name: 'Parent Two', phone: '+15551230008' },
      });
      createdUserIds.push(parent.id);
      await app.prisma.teamMember.create({
        data: { teamId: body.team.id, userId: parent.id, role: 'parent' },
      });
      await app.prisma.session.create({
        data: {
          userId: parent.id,
          tokenHash: hashSecret(parentToken),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/teams/${body.team.id}/accent-color`,
        headers: { authorization: `Bearer ${parentToken}` },
        payload: { primaryColor: 'blue' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('rejects an unrecognized color value', async () => {
      const { body } = await createTeam('+15551230009');

      const response = await app.inject({
        method: 'PATCH',
        url: `/teams/${body.team.id}/accent-color`,
        headers: { authorization: `Bearer ${body.sessionToken}` },
        payload: { primaryColor: 'not-a-real-color' },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
