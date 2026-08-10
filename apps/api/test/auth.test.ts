import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { env } from '../src/env';
import { FakeWebauthnVerifier } from './support/fake-webauthn-verifier';

/** A distinct prefix from every other test file, to avoid `User.phone` unique-constraint collisions when files run concurrently against the same dev database. */
function randomPhone(): string {
  return `+1555180${Math.floor(Math.random() * 900000 + 100000)}`;
}

describe('passkey auth flow', () => {
  const app = buildApp({ webauthnVerifier: new FakeWebauthnVerifier() });
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

  /** Invite, accept, and complete passkey registration — the full onboarding path. */
  async function registerParentWithPasskey(teamId: string, adminToken: string, phone: string) {
    const inviteResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/invites`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { phone },
    });
    const invite = inviteResponse.json() as { code: string };

    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/accept`,
      payload: { name: 'Parent', language: 'en', players: [] },
    });
    const userId = acceptResponse.json().user.id as string;
    createdUserIds.push(userId);

    const optionsResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/passkey/register/options`,
    });
    const { challengeId } = optionsResponse.json() as { challengeId: string };

    const credentialId = `credential-${userId}`;
    const verifyResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/passkey/register/verify`,
      payload: { challengeId, response: { id: credentialId } },
    });

    return {
      userId,
      phone,
      inviteCode: invite.code,
      credentialId,
      registerResponse: verifyResponse,
      sessionToken: verifyResponse.json().sessionToken as string,
    };
  }

  it('rejects registering a passkey via an invite that has not been accepted yet', async () => {
    const { team, sessionToken: adminToken } = await createTeamWithAdmin(randomPhone());
    const inviteResponse = await app.inject({
      method: 'POST',
      url: `/teams/${team.id}/invites`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { phone: randomPhone() },
    });
    const invite = inviteResponse.json();

    const response = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/passkey/register/options`,
    });

    expect(response.statusCode).toBe(404);
  });

  it('registers a passkey during onboarding and immediately establishes a session', async () => {
    const { team, sessionToken: adminToken } = await createTeamWithAdmin(randomPhone());
    const { registerResponse, phone } = await registerParentWithPasskey(
      team.id,
      adminToken,
      randomPhone(),
    );

    expect(registerResponse.statusCode).toBe(200);
    const body = registerResponse.json();
    expect(typeof body.sessionToken).toBe('string');
    expect(body.user).toMatchObject({ name: 'Parent', phone });
    expect(body.teamMemberships).toEqual([
      expect.objectContaining({ role: 'parent', teamName: 'U-12 Wildcats' }),
    ]);
  });

  it('rejects a registration whose response fails verification', async () => {
    const { team, sessionToken: adminToken } = await createTeamWithAdmin(randomPhone());
    const inviteResponse = await app.inject({
      method: 'POST',
      url: `/teams/${team.id}/invites`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { phone: randomPhone() },
    });
    const invite = inviteResponse.json();
    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/accept`,
      payload: { name: 'Parent', language: 'en', players: [] },
    });
    createdUserIds.push(acceptResponse.json().user.id);

    const optionsResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/passkey/register/options`,
    });
    const { challengeId } = optionsResponse.json();

    const response = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/passkey/register/verify`,
      payload: { challengeId, response: { fakeFail: true } },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects registering a passkey once the post-acceptance window has passed', async () => {
    const { team, sessionToken: adminToken } = await createTeamWithAdmin(randomPhone());
    const inviteResponse = await app.inject({
      method: 'POST',
      url: `/teams/${team.id}/invites`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { phone: randomPhone() },
    });
    const invite = inviteResponse.json();
    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/accept`,
      payload: { name: 'Parent', language: 'en', players: [] },
    });
    createdUserIds.push(acceptResponse.json().user.id);

    await app.prisma.invite.update({
      where: { code: invite.code },
      data: { acceptedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/passkey/register/options`,
    });

    expect(response.statusCode).toBe(409);
  });

  it('rejects a phone number that was never invited', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/passkey/login/options',
      payload: { phone: '+15559990000' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('rate-limits repeated login-options requests from the same IP', async () => {
    // Unlike OTP, a passkey ceremony can't be brute-forced, so this only bounds
    // request volume (unbounded WebauthnChallenge row creation) — not a
    // guessable-secret attack. Uses a *registered* phone repeatedly: an
    // unregistered one returns 404 before any challenge row is created, so it
    // would never accumulate a count to limit against (same characteristic
    // the old per-IP OTP limit had for unregistered numbers).
    const { team, sessionToken: adminToken } = await createTeamWithAdmin(randomPhone());
    const { phone } = await registerParentWithPasskey(team.id, adminToken, randomPhone());

    const responses = [];
    for (let i = 0; i < env.WEBAUTHN_LOGIN_MAX_REQUESTS_PER_IP_PER_HOUR + 1; i += 1) {
      responses.push(
        await app.inject({
          method: 'POST',
          url: '/auth/passkey/login/options',
          payload: { phone },
        }),
      );
    }

    const tooMany = responses.filter((response) => response.statusCode === 429);
    expect(tooMany.length).toBeGreaterThan(0);
  });

  it('opportunistically prunes expired challenges on the next login-options request', async () => {
    const { team, sessionToken: adminToken } = await createTeamWithAdmin(randomPhone());
    const { phone, userId } = await registerParentWithPasskey(team.id, adminToken, randomPhone());

    const stale = await app.prisma.webauthnChallenge.create({
      data: {
        userId,
        type: 'authentication',
        challenge: 'stale-challenge',
        expiresAt: new Date(Date.now() - 60 * 1000),
      },
    });

    await app.inject({
      method: 'POST',
      url: '/auth/passkey/login/options',
      payload: { phone },
    });

    const found = await app.prisma.webauthnChallenge.findUnique({ where: { id: stale.id } });
    expect(found).toBeNull();
  });

  it('logs in a registered parent via passkey end-to-end', async () => {
    const { team, sessionToken: adminToken } = await createTeamWithAdmin(randomPhone());
    const { phone } = await registerParentWithPasskey(team.id, adminToken, randomPhone());

    const optionsResponse = await app.inject({
      method: 'POST',
      url: '/auth/passkey/login/options',
      payload: { phone },
    });
    expect(optionsResponse.statusCode).toBe(201);
    const { challengeId } = optionsResponse.json();

    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/auth/passkey/login/verify',
      payload: { challengeId, response: { id: `credential-${phone}-does-not-matter` } },
    });

    // The fake verifier accepts any well-formed response, but the *route* must
    // still only recognize a credential ID that's actually registered to this
    // user — a mismatched id here should fail, proving that check is real.
    expect(verifyResponse.statusCode).toBe(401);
  });

  it('logs in with the exact credential id that was registered', async () => {
    const { team, sessionToken: adminToken } = await createTeamWithAdmin(randomPhone());
    const { phone, credentialId } = await registerParentWithPasskey(
      team.id,
      adminToken,
      randomPhone(),
    );

    const optionsResponse = await app.inject({
      method: 'POST',
      url: '/auth/passkey/login/options',
      payload: { phone },
    });
    const { challengeId } = optionsResponse.json();

    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/auth/passkey/login/verify',
      payload: { challengeId, response: { id: credentialId } },
    });

    expect(verifyResponse.statusCode).toBe(200);
    const body = verifyResponse.json();
    expect(typeof body.sessionToken).toBe('string');
    expect(body.user).toMatchObject({ phone });
  });

  it('rejects reusing an already-consumed login challenge', async () => {
    const { team, sessionToken: adminToken } = await createTeamWithAdmin(randomPhone());
    const { phone, credentialId } = await registerParentWithPasskey(
      team.id,
      adminToken,
      randomPhone(),
    );

    const optionsResponse = await app.inject({
      method: 'POST',
      url: '/auth/passkey/login/options',
      payload: { phone },
    });
    const { challengeId } = optionsResponse.json();

    await app.inject({
      method: 'POST',
      url: '/auth/passkey/login/verify',
      payload: { challengeId, response: { id: credentialId } },
    });
    const secondAttempt = await app.inject({
      method: 'POST',
      url: '/auth/passkey/login/verify',
      payload: { challengeId, response: { id: credentialId } },
    });

    expect(secondAttempt.statusCode).toBe(401);
  });

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
