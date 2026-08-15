import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { hashSecret } from '../src/lib/crypto';
import { normalizeEmail, normalizePhone } from '../src/lib/identifiers';

const PASSWORD = 'Maple-Train!Cloud-47';

describe('password authentication and invitation onboarding', () => {
  const app = buildApp({ passwordAuthEnabled: true });
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];
  const loginIdentifierHashes: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.prisma.passwordLoginAttempt.deleteMany({
      where: { identifierHash: { in: loginIdentifierHashes } },
    });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
    loginIdentifierHashes.length = 0;
  });

  async function createTeamWithAdmin() {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const response = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: `Password onboarding ${suffix}`,
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

  async function createPasswordInvite(
    teamId: string,
    adminToken: string,
    contact: { phone: string } | { email: string },
  ) {
    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/password-invites`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: contact,
    });
    expect(response.statusCode).toBe(201);
    return response.json() as {
      id: string;
      code: string;
      onboardingCode: string;
      phone: string | null;
      email: string | null;
    };
  }

  async function verifyPasswordInvite(linkToken: string, onboardingCode: string) {
    const response = await app.inject({
      method: 'POST',
      url: `/invites/${linkToken}/verify-code`,
      payload: { code: onboardingCode },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as { verificationToken: string; existingAccount: boolean };
  }

  function completionPayload(verificationToken: string) {
    return {
      verificationToken,
      name: 'Password Parent',
      language: 'en',
      players: [{ name: 'Password Player', age: 10 }],
      password: PASSWORD,
      passwordConfirmation: PASSWORD,
    };
  }

  it('requires exactly one invitation contact method', async () => {
    const { team, sessionToken } = await createTeamWithAdmin();

    const neither = await app.inject({
      method: 'POST',
      url: `/teams/${team.id}/password-invites`,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: {},
    });
    const both = await app.inject({
      method: 'POST',
      url: `/teams/${team.id}/password-invites`,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { phone: '+15559000001', email: 'both@example.com' },
    });

    expect(neither.statusCode).toBe(400);
    expect(both.statusCode).toBe(400);
    expect(await app.prisma.invite.count({ where: { teamId: team.id } })).toBe(0);
  });

  it('requires the matching link token and one-time code before onboarding', async () => {
    const { team, sessionToken } = await createTeamWithAdmin();
    const email = `parent-${randomUUID()}@example.com`;
    const invite = await createPasswordInvite(team.id, sessionToken, { email });

    const persistedInvite = await app.prisma.invite.findUniqueOrThrow({
      where: { id: invite.id },
    });
    expect(persistedInvite.codeVersion).toBe(2);
    expect(persistedInvite.code).toBe(hashSecret(invite.code));
    expect(persistedInvite.code).not.toBe(invite.code);
    expect(persistedInvite.onboardingCodeHash).not.toBe(invite.onboardingCode);

    const preview = await app.inject({ method: 'GET', url: `/invites/${invite.code}` });
    const wrongLink = await app.inject({
      method: 'POST',
      url: `/invites/${randomUUID()}/verify-code`,
      payload: { code: invite.onboardingCode },
    });
    const wrongCode = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/verify-code`,
      payload: { code: invite.onboardingCode === '000000' ? '000001' : '000000' },
    });
    const verified = await verifyPasswordInvite(invite.code, invite.onboardingCode);

    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ status: 'pending', requiresCode: true });
    expect(wrongLink.statusCode).toBe(400);
    expect(wrongLink.json()).toEqual({ message: 'This invitation or code is invalid or expired.' });
    expect(wrongCode.statusCode).toBe(400);
    expect(wrongCode.json()).toEqual(wrongLink.json());
    expect(verified.existingAccount).toBe(false);
    expect(verified.verificationToken).toHaveLength(43);
  });

  it('atomically completes onboarding once and rejects verification-token replay', async () => {
    const { team, sessionToken } = await createTeamWithAdmin();
    const phone = `+1555${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`;
    const invite = await createPasswordInvite(team.id, sessionToken, { phone });
    const verified = await verifyPasswordInvite(invite.code, invite.onboardingCode);
    const payload = completionPayload(verified.verificationToken);

    const responses = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/invites/${invite.code}/complete-password-onboarding`,
        payload,
      }),
      app.inject({
        method: 'POST',
        url: `/invites/${invite.code}/complete-password-onboarding`,
        payload,
      }),
    ]);
    const successes = responses.filter((response) => response.statusCode === 201);
    const rejections = responses.filter((response) => response.statusCode !== 201);

    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(1);
    expect([400, 409]).toContain(rejections[0]?.statusCode);
    const successfulBody = successes[0]!.json() as { user: { id: string }; authMethod: string };
    createdUserIds.push(successfulBody.user.id);
    expect(successfulBody.authMethod).toBe('password');
    expect(String(successes[0]!.headers['set-cookie'])).toContain('session=');

    const persistedInvite = await app.prisma.invite.findUniqueOrThrow({
      where: { id: invite.id },
    });
    expect(persistedInvite).toMatchObject({
      status: 'accepted',
      acceptedByUserId: successfulBody.user.id,
      verificationTokenHash: null,
      verificationExpiresAt: null,
    });
    expect(await app.prisma.user.count({ where: { normalizedPhone: phone } })).toBe(1);
    expect(
      await app.prisma.passwordCredential.count({ where: { userId: successfulBody.user.id } }),
    ).toBe(1);
    expect(
      await app.prisma.teamMember.count({
        where: { teamId: team.id, userId: successfulBody.user.id, role: 'parent' },
      }),
    ).toBe(1);
    expect(
      await app.prisma.player.count({
        where: { teamId: team.id, parents: { some: { userId: successfulBody.user.id } } },
      }),
    ).toBe(1);

    const replay = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/complete-password-onboarding`,
      payload,
    });
    expect(replay.statusCode).toBe(400);
  });

  it('logs in with a normalized email and returns the password-authenticated session', async () => {
    const { team, sessionToken } = await createTeamWithAdmin();
    const email = `parent-${randomUUID()}@example.com`;
    const invite = await createPasswordInvite(team.id, sessionToken, { email });
    const verified = await verifyPasswordInvite(invite.code, invite.onboardingCode);
    const onboarded = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/complete-password-onboarding`,
      payload: completionPayload(verified.verificationToken),
    });
    expect(onboarded.statusCode).toBe(201);
    const userId = onboarded.json().user.id as string;
    createdUserIds.push(userId);

    const identifier = `  ${email.toUpperCase()}  `;
    loginIdentifierHashes.push(hashSecret(normalizeEmail(identifier)));
    const login = await app.inject({
      method: 'POST',
      url: '/auth/password/login',
      payload: { identifier, password: PASSWORD },
    });

    expect(login.statusCode).toBe(200);
    expect(String(login.headers['set-cookie'])).toContain('session=');
    expect(login.json()).toMatchObject({
      user: { id: userId, email },
      authMethod: 'password',
      teamMemberships: [{ teamId: team.id, role: 'parent' }],
    });
  });

  it('logs in with a normalized phone number as the username', async () => {
    const { team, sessionToken } = await createTeamWithAdmin();
    const phone = `+1555${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`;
    const invite = await createPasswordInvite(team.id, sessionToken, { phone });
    const verified = await verifyPasswordInvite(invite.code, invite.onboardingCode);
    const onboarded = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/complete-password-onboarding`,
      payload: completionPayload(verified.verificationToken),
    });
    expect(onboarded.statusCode).toBe(201);
    const userId = onboarded.json().user.id as string;
    createdUserIds.push(userId);

    const formattedPhone = `+1 (${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`;
    loginIdentifierHashes.push(hashSecret(normalizePhone(formattedPhone)));
    const login = await app.inject({
      method: 'POST',
      url: '/auth/password/login',
      payload: { identifier: formattedPhone, password: PASSWORD },
    });

    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({
      user: { id: userId, phone },
      authMethod: 'password',
      teamMemberships: [{ teamId: team.id, role: 'parent' }],
    });
  });

  it('returns the same generic failure for unknown users and wrong passwords', async () => {
    const { team, sessionToken } = await createTeamWithAdmin();
    const email = `parent-${randomUUID()}@example.com`;
    const unknownEmail = `unknown-${randomUUID()}@example.com`;
    const invite = await createPasswordInvite(team.id, sessionToken, { email });
    const verified = await verifyPasswordInvite(invite.code, invite.onboardingCode);
    const onboarded = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/complete-password-onboarding`,
      payload: completionPayload(verified.verificationToken),
    });
    expect(onboarded.statusCode).toBe(201);
    createdUserIds.push(onboarded.json().user.id);
    loginIdentifierHashes.push(hashSecret(normalizeEmail(email)), hashSecret(unknownEmail));

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/auth/password/login',
      payload: { identifier: email, password: 'Incorrect-Password-99' },
    });
    const unknownUser = await app.inject({
      method: 'POST',
      url: '/auth/password/login',
      payload: { identifier: unknownEmail, password: 'Incorrect-Password-99' },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual({ message: 'Invalid username or password.' });
    expect(unknownUser.json()).toEqual(wrongPassword.json());
  });
});
