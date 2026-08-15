import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { normalizeEmail } from '../src/lib/identifiers';

const PASSWORD = 'Cedar-River!Otter-52';
const NEW_PASSWORD = 'Willow-Harbor!Finch-81';

/**
 * Regression coverage for re-inviting a removed parent to the same
 * phone/email. Before this fix, the matched (but deactivated) user row
 * routed the new invite into "attach existing account", a dead end: login
 * (required to attach) rejects isActive:false accounts, and a fresh
 * registration attempt also 409'd against the same inactive row. Now a
 * matching inactive account is reactivated as part of completing password
 * onboarding, mirroring the recovery intent already documented for the
 * legacy passkey invite flow.
 */
describe('re-inviting a removed parent', () => {
  const app = buildApp({ passwordAuthEnabled: true });
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
        teamName: `Reactivation ${suffix}`,
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

  async function invitePasswordParent(teamId: string, adminToken: string, email: string) {
    const inviteResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/password-invites`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email },
    });
    expect(inviteResponse.statusCode).toBe(201);
    return inviteResponse.json() as { code: string; onboardingCode: string };
  }

  async function verifyAndOnboard(code: string, onboardingCode: string, password: string) {
    const verifyResponse = await app.inject({
      method: 'POST',
      url: `/invites/${code}/verify-code`,
      payload: { code: onboardingCode },
    });
    expect(verifyResponse.statusCode).toBe(200);
    const verified = verifyResponse.json() as {
      verificationToken: string;
      existingAccount: boolean;
    };
    const onboardResponse = await app.inject({
      method: 'POST',
      url: `/invites/${code}/complete-password-onboarding`,
      payload: {
        verificationToken: verified.verificationToken,
        name: 'Password Parent',
        language: 'en',
        players: [],
        password,
        passwordConfirmation: password,
      },
    });
    return { verified, onboardResponse };
  }

  it('reactivates a removed parent instead of dead-ending on an unreachable existing account', async () => {
    const { team, sessionToken: adminToken } = await createTeamWithAdmin();
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const email = `parent-${suffix}@example.com`;

    const firstInvite = await invitePasswordParent(team.id, adminToken, email);
    const { onboardResponse: firstOnboard } = await verifyAndOnboard(
      firstInvite.code,
      firstInvite.onboardingCode,
      PASSWORD,
    );
    expect(firstOnboard.statusCode).toBe(201);
    const userId = (firstOnboard.json() as { user: { id: string } }).user.id;
    createdUserIds.push(userId);

    const removal = await app.inject({
      method: 'DELETE',
      url: `/teams/${team.id}/members/${userId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(removal.statusCode).toBe(204);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: userId } })).isActive).toBe(
      false,
    );

    const secondInvite = await invitePasswordParent(team.id, adminToken, email);
    const { verified, onboardResponse: secondOnboard } = await verifyAndOnboard(
      secondInvite.code,
      secondInvite.onboardingCode,
      NEW_PASSWORD,
    );

    // Login is impossible for a deactivated user, so "attach existing
    // account" must not be offered here.
    expect(verified.existingAccount).toBe(false);

    expect(secondOnboard.statusCode).toBe(201);
    const reactivatedId = (secondOnboard.json() as { user: { id: string } }).user.id;

    // Reactivated the same row — not a colliding duplicate (phone/email are
    // globally unique on User, so a naive fix would 500 here instead).
    expect(reactivatedId).toBe(userId);
    expect(await app.prisma.user.count({ where: { normalizedEmail: normalizeEmail(email) } })).toBe(
      1,
    );
    const reactivatedUser = await app.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(reactivatedUser.isActive).toBe(true);
    expect(
      await app.prisma.teamMember.count({ where: { teamId: team.id, userId, role: 'parent' } }),
    ).toBe(1);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/password/login',
      payload: { identifier: email, password: NEW_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ user: { id: userId } });
  });

  it('still blocks onboarding when the matching account is active', async () => {
    const { team, sessionToken: adminToken } = await createTeamWithAdmin();
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const email = `parent-${suffix}@example.com`;

    const firstInvite = await invitePasswordParent(team.id, adminToken, email);
    const { onboardResponse: firstOnboard } = await verifyAndOnboard(
      firstInvite.code,
      firstInvite.onboardingCode,
      PASSWORD,
    );
    expect(firstOnboard.statusCode).toBe(201);
    createdUserIds.push((firstOnboard.json() as { user: { id: string } }).user.id);

    const secondInvite = await invitePasswordParent(team.id, adminToken, email);
    const { verified, onboardResponse: secondOnboard } = await verifyAndOnboard(
      secondInvite.code,
      secondInvite.onboardingCode,
      NEW_PASSWORD,
    );

    expect(verified.existingAccount).toBe(true);
    expect(secondOnboard.statusCode).toBe(409);
  });
});
