import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { FakeWebauthnVerifier } from './support/fake-webauthn-verifier';

const PASSWORD = 'Cedar-River!Otter-52';

/**
 * Regression coverage for a password-only user's first, self-service
 * passkey. Before this fix, `/auth/passkey/register/options` and
 * `/register/verify` both hard-rejected authMethod==='password' with no
 * other path to add a credential — a parent promoted to team-admin (which
 * requires passkey assurance via requirePrivilegedAssurance) was
 * permanently locked out of every admin action.
 */
describe('password session self-service passkey registration', () => {
  const app = buildApp({ passwordAuthEnabled: true, webauthnVerifier: new FakeWebauthnVerifier() });
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  async function createTeamWithAdmin() {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const response = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: `Passkey upgrade ${suffix}`,
        season: 'Fall 2026',
        adminName: 'Admin Parent',
        adminEmail: `admin-${suffix}@example.com`,
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      team: { id: string };
      admin: { id: string };
      sessionToken: string;
    };
    createdTeamIds.push(body.team.id);
    createdUserIds.push(body.admin.id);
    return body;
  }

  async function onboardPasswordParent(teamId: string, adminToken: string) {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const email = `parent-${suffix}@example.com`;
    const inviteResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/password-invites`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email },
    });
    const invite = inviteResponse.json() as { code: string; onboardingCode: string };
    const verifyResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/verify-code`,
      payload: { code: invite.onboardingCode },
    });
    const { verificationToken } = verifyResponse.json() as { verificationToken: string };
    const onboardResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/complete-password-onboarding`,
      payload: {
        verificationToken,
        name: 'Password Parent',
        language: 'en',
        players: [],
        password: PASSWORD,
        passwordConfirmation: PASSWORD,
      },
    });
    expect(onboardResponse.statusCode).toBe(201);
    const body = onboardResponse.json() as { user: { id: string }; sessionToken: string };
    createdUserIds.push(body.user.id);
    return { ...body, email };
  }

  it('lets a promoted password-only admin self-service a first passkey and immediately unblocks privileged actions', async () => {
    const { team, sessionToken: adminToken } = await createTeamWithAdmin();
    const { user, sessionToken: parentToken } = await onboardPasswordParent(team.id, adminToken);

    const promote = await app.inject({
      method: 'PATCH',
      url: `/teams/${team.id}/members/${user.id}/role`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: 'admin' },
    });
    expect(promote.statusCode).toBe(200);

    // Before this fix, a password session could never register a passkey,
    // so this 403 would be permanent.
    const blockedInvite = await app.inject({
      method: 'POST',
      url: `/teams/${team.id}/invites`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload: { phone: '+15559991234' },
    });
    expect(blockedInvite.statusCode).toBe(403);

    const optionsResponse = await app.inject({
      method: 'POST',
      url: '/auth/passkey/register/options',
      headers: { authorization: `Bearer ${parentToken}` },
    });
    expect(optionsResponse.statusCode).toBe(201);
    const { challengeId } = optionsResponse.json() as { challengeId: string };

    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/auth/passkey/register/verify',
      headers: { authorization: `Bearer ${parentToken}` },
      payload: { challengeId, response: { id: `credential-${user.id}` } },
    });
    expect(verifyResponse.statusCode).toBe(204);
    expect(await app.prisma.passkey.count({ where: { userId: user.id } })).toBe(1);

    // The same session now carries fresh passkey assurance — no re-login
    // required — so the previously-blocked admin action succeeds.
    const allowedInvite = await app.inject({
      method: 'POST',
      url: `/teams/${team.id}/invites`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload: { phone: '+15559991235' },
    });
    expect(allowedInvite.statusCode).toBe(201);
  });

  it('rejects self-service registration once the account already has a passkey', async () => {
    const { team, sessionToken: adminToken } = await createTeamWithAdmin();
    const {
      user,
      sessionToken: firstSession,
      email,
    } = await onboardPasswordParent(team.id, adminToken);

    const firstOptions = await app.inject({
      method: 'POST',
      url: '/auth/passkey/register/options',
      headers: { authorization: `Bearer ${firstSession}` },
    });
    const { challengeId: firstChallengeId } = firstOptions.json() as { challengeId: string };
    const firstVerify = await app.inject({
      method: 'POST',
      url: '/auth/passkey/register/verify',
      headers: { authorization: `Bearer ${firstSession}` },
      payload: { challengeId: firstChallengeId, response: { id: `credential-${user.id}-1` } },
    });
    expect(firstVerify.statusCode).toBe(204);

    // Log in again with the password — a fresh authMethod==='password'
    // session on an account that now already owns a passkey.
    const secondLogin = await app.inject({
      method: 'POST',
      url: '/auth/password/login',
      payload: { identifier: email, password: PASSWORD },
    });
    expect(secondLogin.statusCode).toBe(200);
    const secondSession = secondLogin.json().sessionToken as string;

    const secondOptions = await app.inject({
      method: 'POST',
      url: '/auth/passkey/register/options',
      headers: { authorization: `Bearer ${secondSession}` },
    });
    expect(secondOptions.statusCode).toBe(403);
    expect(await app.prisma.passkey.count({ where: { userId: user.id } })).toBe(1);
  });
});
