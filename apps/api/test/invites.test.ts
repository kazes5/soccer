import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { generateSessionToken, hashSecret } from '../src/lib/crypto';

async function createTeamWithAdmin(app: FastifyInstance, adminPhone: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/teams',
    payload: {
      teamName: 'U-12 Wildcats',
      season: 'Fall 2026',
      adminName: 'Dana Cohen',
      adminPhone,
    },
  });
  const body = response.json() as {
    team: { id: string };
    admin: { id: string };
    sessionToken: string;
  };
  return { teamId: body.team.id, adminId: body.admin.id, sessionToken: body.sessionToken };
}

describe('POST /teams/:teamId/invites', () => {
  const app = buildApp();
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  it('lets the team admin create an invite', async () => {
    const { teamId, adminId, sessionToken } = await createTeamWithAdmin(app, '+15551230010');
    createdTeamIds.push(teamId);
    createdUserIds.push(adminId);

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/invites`,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { phone: '+15551230011' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ teamId, phone: '+15551230011', status: 'pending' });
    expect(typeof body.code).toBe('string');
  });

  it('rejects an unauthenticated request', async () => {
    const { teamId, adminId } = await createTeamWithAdmin(app, '+15551230012');
    createdTeamIds.push(teamId);
    createdUserIds.push(adminId);

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/invites`,
      payload: { phone: '+15551230013' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects a non-admin team member', async () => {
    const { teamId, adminId } = await createTeamWithAdmin(app, '+15551230014');
    createdTeamIds.push(teamId);
    createdUserIds.push(adminId);

    const parent = await app.prisma.user.create({
      data: {
        name: 'Avi Levi',
        phone: '+15551230015',
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

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/invites`,
      headers: { authorization: `Bearer ${rawToken}` },
      payload: { phone: '+15551230016' },
    });

    expect(response.statusCode).toBe(403);
  });
});
