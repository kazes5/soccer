import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

const PASSWORD = 'Cedar-River!Otter-52';

/** A distinct prefix from every other test file, to avoid `User.phone` unique-constraint collisions when files run concurrently against the same dev database. */
function randomPhone(): string {
  return `+1555180${Math.floor(Math.random() * 900000 + 100000)}`;
}

describe('session lifecycle', () => {
  const app = buildApp();
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  async function createTeamWithAdmin(adminPhone: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPhone,
        adminPassword: PASSWORD,
        adminPasswordConfirmation: PASSWORD,
      },
    });
    const body = response.json() as {
      team: { id: string };
      admin: { id: string };
      sessionToken: string;
    };
    createdTeamIds.push(body.team.id);
    createdUserIds.push(body.admin.id);
    return body;
  }

  it('revokes the session on logout so it can no longer authenticate', async () => {
    const { team, sessionToken } = await createTeamWithAdmin(randomPhone());

    const beforeLogout = await app.inject({
      method: 'POST',
      url: `/teams/${team.id}/invites`,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { phone: randomPhone() },
    });
    expect(beforeLogout.statusCode).toBe(201);

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(logoutResponse.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: 'POST',
      url: `/teams/${team.id}/invites`,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { phone: randomPhone() },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('logging out with no session token is a harmless no-op', async () => {
    const response = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(response.statusCode).toBe(204);
  });

  it('reports a bodyless request with a declared JSON content type as a client error, not a 500', async () => {
    // A real browser fetch() with no body but Content-Type: application/json (as the web
    // client used to always send) makes Fastify's JSON parser throw a 400 FastifyError.
    // Regression: the error handler was falling through to a misleading 500 for it instead
    // of passing through the parser's own 4xx status.
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(400);
  });
});
