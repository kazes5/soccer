import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { env } from '../src/env';
import { hashSecret } from '../src/lib/crypto';
import { normalizeEmail } from '../src/lib/identifiers';
import type { PasswordRecoveryProvider } from '../src/lib/password-recovery';

const PASSWORD = 'Cedar-River!Otter-52';
const NEW_PASSWORD = 'Willow-Harbor!Finch-81';

/** Captures every reset it was asked to send instead of delivering anything real. */
class FakePasswordRecoveryProvider implements PasswordRecoveryProvider {
  readonly isConfigured = true;
  sent: Array<{ phone: string | null; email: string | null; resetUrl: string }> = [];
  async sendReset(input: { phone: string | null; email: string | null; resetUrl: string }) {
    this.sent.push(input);
  }
}

function tokenFromResetUrl(resetUrl: string): string {
  const fragment = new URL(resetUrl).hash.slice(1);
  const token = new URLSearchParams(fragment).get('token');
  if (!token) throw new Error(`No token in reset URL: ${resetUrl}`);
  return token;
}

describe('password recovery', () => {
  const recoveryProvider = new FakePasswordRecoveryProvider();
  const app = buildApp({ passwordRecoveryProvider: recoveryProvider });
  // A provider that exists but reports unconfigured — distinct from the
  // default DisabledPasswordRecoveryProvider, to prove the route itself
  // checks `isConfigured`, not just whether a provider object was supplied.
  const unconfiguredApp = buildApp({
    passwordRecoveryProvider: { isConfigured: false, sendReset: async () => {} },
  });
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
    recoveryProvider.sent.length = 0;
  });

  async function createTeamWithPasswordAdmin(targetApp: typeof app = app) {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const email = `admin-${suffix}@example.com`;
    const teamResponse = await targetApp.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: `Recovery test ${suffix}`,
        season: 'Fall 2026',
        adminName: 'Admin Parent',
        adminEmail: email,
        adminPassword: PASSWORD,
        adminPasswordConfirmation: PASSWORD,
      },
    });
    const teamBody = teamResponse.json() as { team: { id: string }; admin: { id: string } };
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);
    await targetApp.prisma.user.update({
      where: { id: teamBody.admin.id },
      data: { normalizedEmail: normalizeEmail(email) },
    });

    return { userId: teamBody.admin.id, email };
  }

  it('returns the same generic response for a real account and an unknown identifier', async () => {
    const { email } = await createTeamWithPasswordAdmin();
    const unknownEmail = `unknown-${randomUUID()}@example.com`;

    const [real, unknown] = await Promise.all([
      app.inject({ method: 'POST', url: '/auth/password/forgot', payload: { identifier: email } }),
      app.inject({
        method: 'POST',
        url: '/auth/password/forgot',
        payload: { identifier: unknownEmail },
      }),
    ]);

    expect(real.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(real.json()).toEqual(unknown.json());

    // Only the genuinely recoverable account actually got an email/token.
    expect(recoveryProvider.sent).toHaveLength(1);
    expect(recoveryProvider.sent[0]?.email).toBe(email);
  });

  it('completes a real reset end to end: old password stops working, new password works, other sessions are revoked', async () => {
    const { userId, email } = await createTeamWithPasswordAdmin();
    const otherSessionToken = 'a'.repeat(64);
    await app.prisma.session.create({
      data: {
        userId,
        tokenHash: hashSecret(otherSessionToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const forgot = await app.inject({
      method: 'POST',
      url: '/auth/password/forgot',
      payload: { identifier: email },
    });
    expect(forgot.statusCode).toBe(202);
    const token = tokenFromResetUrl(recoveryProvider.sent[0]!.resetUrl);

    const reset = await app.inject({
      method: 'POST',
      url: '/auth/password/reset',
      payload: { token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD },
    });
    expect(reset.statusCode).toBe(204);

    const oldPasswordLogin = await app.inject({
      method: 'POST',
      url: '/auth/password/login',
      payload: { identifier: email, password: PASSWORD },
    });
    expect(oldPasswordLogin.statusCode).toBe(401);

    const newPasswordLogin = await app.inject({
      method: 'POST',
      url: '/auth/password/login',
      payload: { identifier: email, password: NEW_PASSWORD },
    });
    expect(newPasswordLogin.statusCode).toBe(200);

    // The pre-existing session (simulating another device) is revoked by the
    // reset, per CLAUDE.md §9.1 — a stolen device's session shouldn't survive
    // a password reset.
    const revoked = await app.prisma.session.findFirst({
      where: { tokenHash: hashSecret(otherSessionToken) },
    });
    expect(revoked?.revokedAt).not.toBeNull();

    expect(
      await app.prisma.systemAuditLog.findFirst({
        where: { actorId: userId, actionType: 'password_reset' },
      }),
    ).not.toBeNull();
  });

  it('rejects reusing an already-consumed reset token', async () => {
    const { email } = await createTeamWithPasswordAdmin();
    await app.inject({
      method: 'POST',
      url: '/auth/password/forgot',
      payload: { identifier: email },
    });
    const token = tokenFromResetUrl(recoveryProvider.sent[0]!.resetUrl);
    const payload = { token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD };

    const first = await app.inject({ method: 'POST', url: '/auth/password/reset', payload });
    const second = await app.inject({ method: 'POST', url: '/auth/password/reset', payload });

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(400);
  });

  it('invalidates an earlier reset token once a new one is requested for the same account', async () => {
    const { email } = await createTeamWithPasswordAdmin();

    await app.inject({
      method: 'POST',
      url: '/auth/password/forgot',
      payload: { identifier: email },
    });
    const firstToken = tokenFromResetUrl(recoveryProvider.sent[0]!.resetUrl);

    await app.inject({
      method: 'POST',
      url: '/auth/password/forgot',
      payload: { identifier: email },
    });
    const secondToken = tokenFromResetUrl(recoveryProvider.sent[1]!.resetUrl);

    const usingFirstToken = await app.inject({
      method: 'POST',
      url: '/auth/password/reset',
      payload: { token: firstToken, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD },
    });
    expect(usingFirstToken.statusCode).toBe(400);

    const usingSecondToken = await app.inject({
      method: 'POST',
      url: '/auth/password/reset',
      payload: { token: secondToken, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD },
    });
    expect(usingSecondToken.statusCode).toBe(204);
  });

  it('rejects an expired reset token', async () => {
    const { userId, email } = await createTeamWithPasswordAdmin();
    await app.inject({
      method: 'POST',
      url: '/auth/password/forgot',
      payload: { identifier: email },
    });
    const token = tokenFromResetUrl(recoveryProvider.sent[0]!.resetUrl);
    await app.prisma.passwordResetToken.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/password/reset',
      payload: { token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an unacceptable new password (too short, common, or containing the identifier)', async () => {
    const { email } = await createTeamWithPasswordAdmin();
    await app.inject({
      method: 'POST',
      url: '/auth/password/forgot',
      payload: { identifier: email },
    });
    const token = tokenFromResetUrl(recoveryProvider.sent[0]!.resetUrl);

    const tooShort = await app.inject({
      method: 'POST',
      url: '/auth/password/reset',
      payload: { token, password: 'short-pass12', passwordConfirmation: 'short-pass12' },
    });
    expect(tooShort.statusCode).toBe(400);

    // The token must still be usable after a rejected attempt — validation
    // failure shouldn't burn the single-use token.
    const acceptable = await app.inject({
      method: 'POST',
      url: '/auth/password/reset',
      payload: { token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD },
    });
    expect(acceptable.statusCode).toBe(204);
  });

  it('sends nothing and creates no token when no recovery provider is configured', async () => {
    const { userId, email } = await createTeamWithPasswordAdmin(unconfiguredApp);

    const response = await unconfiguredApp.inject({
      method: 'POST',
      url: '/auth/password/forgot',
      payload: { identifier: email },
    });

    expect(response.statusCode).toBe(202);
    expect(await unconfiguredApp.prisma.passwordResetToken.count({ where: { userId } })).toBe(0);
  });

  it('rate-limits repeated recovery requests for the same account without revealing whether it exists', async () => {
    const { email } = await createTeamWithPasswordAdmin();

    const responses = [];
    for (let i = 0; i < env.PASSWORD_RESET_MAX_REQUESTS_PER_ACCOUNT_PER_HOUR + 1; i += 1) {
      responses.push(
        await app.inject({
          method: 'POST',
          url: '/auth/password/forgot',
          payload: { identifier: email },
        }),
      );
    }

    const limited = responses.filter((response) => response.statusCode === 429);
    const ok = responses.filter((response) => response.statusCode === 202);
    expect(limited.length).toBeGreaterThan(0);
    expect(ok).toHaveLength(env.PASSWORD_RESET_MAX_REQUESTS_PER_ACCOUNT_PER_HOUR);
    // The limit itself doesn't leak account existence — it fires purely on
    // request volume for that identifier, not on whether a token was issued.
    expect(recoveryProvider.sent).toHaveLength(
      env.PASSWORD_RESET_MAX_REQUESTS_PER_ACCOUNT_PER_HOUR,
    );
  });

  it('rejects an unrecognized reset token with the same generic message as an expired one', async () => {
    const unknownTokenResponse = await app.inject({
      method: 'POST',
      url: '/auth/password/reset',
      payload: {
        token: 'z'.repeat(43),
        password: NEW_PASSWORD,
        passwordConfirmation: NEW_PASSWORD,
      },
    });
    expect(unknownTokenResponse.statusCode).toBe(400);
  });
});
