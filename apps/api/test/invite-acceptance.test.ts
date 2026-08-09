import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

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

async function createInvite(
  app: FastifyInstance,
  teamId: string,
  sessionToken: string,
  phone: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: `/teams/${teamId}/invites`,
    headers: { authorization: `Bearer ${sessionToken}` },
    payload: { phone },
  });
  return response.json() as { code: string };
}

describe('POST /invites/:code/accept', () => {
  const app = buildApp();
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  it('creates the invited parent, links players, and marks the invite accepted', async () => {
    const { teamId, adminId, sessionToken } = await createTeamWithAdmin(app, '+15551230100');
    createdTeamIds.push(teamId);
    createdUserIds.push(adminId);
    const invite = await createInvite(app, teamId, sessionToken, '+15551230101');

    const response = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/accept`,
      payload: {
        name: 'Avi Levi',
        players: [{ name: 'Yossi Levi', age: 11 }],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    createdUserIds.push(body.user.id);
    expect(body.user).toMatchObject({ name: 'Avi Levi', phone: '+15551230101' });
    expect(body.team).toMatchObject({ id: teamId, name: 'U-12 Wildcats' });
    expect(body.players).toEqual([expect.objectContaining({ name: 'Yossi Levi', age: 11 })]);

    const membership = await app.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: body.user.id } },
    });
    expect(membership?.role).toBe('parent');

    const updatedInvite = await app.prisma.invite.findUnique({ where: { code: invite.code } });
    expect(updatedInvite?.status).toBe('accepted');
  });

  it('lets the newly registered parent log in via OTP afterward', async () => {
    const { teamId, adminId, sessionToken } = await createTeamWithAdmin(app, '+15551230102');
    createdTeamIds.push(teamId);
    createdUserIds.push(adminId);
    const invite = await createInvite(app, teamId, sessionToken, '+15551230103');

    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/accept`,
      payload: { name: 'Sarah Katz' },
    });
    createdUserIds.push(acceptResponse.json().user.id);

    const otpResponse = await app.inject({
      method: 'POST',
      url: '/auth/otp/request',
      payload: { phone: '+15551230103' },
    });

    expect(otpResponse.statusCode).toBe(201);
  });

  it('rejects accepting the same invite twice', async () => {
    const { teamId, adminId, sessionToken } = await createTeamWithAdmin(app, '+15551230104');
    createdTeamIds.push(teamId);
    createdUserIds.push(adminId);
    const invite = await createInvite(app, teamId, sessionToken, '+15551230105');

    const first = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/accept`,
      payload: { name: 'Avi Levi' },
    });
    createdUserIds.push(first.json().user.id);

    const second = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/accept`,
      payload: { name: 'Avi Levi' },
    });

    expect(second.statusCode).toBe(409);
  });

  it('rejects an unknown invite code', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/invites/does-not-exist/accept',
      payload: { name: 'Avi Levi' },
    });

    expect(response.statusCode).toBe(404);
  });
});
