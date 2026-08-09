import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { env } from '../src/env';
import { RecordingOtpProvider } from './support/recording-otp-provider';

describe('OTP login flow', () => {
  const otpProvider = new RecordingOtpProvider();
  const app = buildApp({ otpProvider });
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
    otpProvider.sent = [];
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
    const body = response.json() as { team: { id: string }; admin: { id: string } };
    createdTeamIds.push(body.team.id);
    createdUserIds.push(body.admin.id);
    return body;
  }

  it('rejects a phone number that was never invited', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/otp/request',
      payload: { phone: '+15559990000' },
    });

    expect(response.statusCode).toBe(404);
    expect(otpProvider.sent).toHaveLength(0);
  });

  it('logs in a recognized user end-to-end', async () => {
    await createTeamWithAdmin('+15551230020');

    const requestResponse = await app.inject({
      method: 'POST',
      url: '/auth/otp/request',
      payload: { phone: '+15551230020' },
    });
    expect(requestResponse.statusCode).toBe(201);
    const { challengeId } = requestResponse.json();
    expect(otpProvider.lastCode).toMatch(/^\d{6}$/);

    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/auth/otp/verify',
      payload: { challengeId, code: otpProvider.lastCode },
    });

    expect(verifyResponse.statusCode).toBe(200);
    const body = verifyResponse.json();
    expect(typeof body.sessionToken).toBe('string');
    expect(body.user).toMatchObject({ name: 'Dana Cohen', phone: '+15551230020' });
    expect(body.teamMemberships).toEqual([
      expect.objectContaining({ role: 'admin', teamName: 'U-12 Wildcats' }),
    ]);
  });

  it('rejects an incorrect code without consuming the challenge', async () => {
    await createTeamWithAdmin('+15551230021');

    const requestResponse = await app.inject({
      method: 'POST',
      url: '/auth/otp/request',
      payload: { phone: '+15551230021' },
    });
    const { challengeId } = requestResponse.json();

    const wrongResponse = await app.inject({
      method: 'POST',
      url: '/auth/otp/verify',
      payload: { challengeId, code: '000000' },
    });
    expect(wrongResponse.statusCode).toBe(401);

    const correctResponse = await app.inject({
      method: 'POST',
      url: '/auth/otp/verify',
      payload: { challengeId, code: otpProvider.lastCode },
    });
    expect(correctResponse.statusCode).toBe(200);
  });

  it('rejects reusing an already-consumed challenge', async () => {
    await createTeamWithAdmin('+15551230022');

    const requestResponse = await app.inject({
      method: 'POST',
      url: '/auth/otp/request',
      payload: { phone: '+15551230022' },
    });
    const { challengeId } = requestResponse.json();
    const code = otpProvider.lastCode;

    await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { challengeId, code } });
    const secondAttempt = await app.inject({
      method: 'POST',
      url: '/auth/otp/verify',
      payload: { challengeId, code },
    });

    expect(secondAttempt.statusCode).toBe(401);
  });

  it('rate-limits repeated code requests for the same user', async () => {
    await createTeamWithAdmin('+15551230023');
    const requestOnce = () =>
      app.inject({
        method: 'POST',
        url: '/auth/otp/request',
        payload: { phone: '+15551230023' },
      });

    await requestOnce();
    await requestOnce();
    await requestOnce();
    const fourth = await requestOnce();

    expect(fourth.statusCode).toBe(429);
  });

  it('rate-limits repeated code requests from the same IP across different users', async () => {
    const phones = Array.from(
      { length: env.OTP_MAX_REQUESTS_PER_IP_PER_HOUR + 1 },
      (_, i) => `+1555124${(1000 + i).toString().slice(-4)}`,
    );
    for (const phone of phones) {
      await createTeamWithAdmin(phone);
    }

    const responses = [];
    for (const phone of phones) {
      responses.push(
        await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } }),
      );
    }

    const tooMany = responses.filter((response) => response.statusCode === 429);
    expect(tooMany.length).toBeGreaterThan(0);
  });

  it('is not fooled by a spoofed X-Forwarded-For header (TRUST_PROXY defaults to false)', async () => {
    // Regression: without an explicit, deliberate TRUST_PROXY=true (only correct when a real
    // reverse proxy sets this header), a client-supplied X-Forwarded-For must not let an
    // attacker evade the per-IP OTP rate limit by spoofing a fresh IP on every request.
    const phones = Array.from(
      { length: env.OTP_MAX_REQUESTS_PER_IP_PER_HOUR + 1 },
      (_, i) => `+1555128${(1000 + i).toString().slice(-4)}`,
    );
    for (const phone of phones) {
      await createTeamWithAdmin(phone);
    }

    const responses = [];
    for (const [index, phone] of phones.entries()) {
      responses.push(
        await app.inject({
          method: 'POST',
          url: '/auth/otp/request',
          headers: { 'x-forwarded-for': `10.0.0.${index}` },
          payload: { phone },
        }),
      );
    }

    const tooMany = responses.filter((response) => response.statusCode === 429);
    expect(tooMany.length).toBeGreaterThan(0);
  });

  it('revokes the session on logout so it can no longer authenticate', async () => {
    const {
      team: { id: teamId },
    } = await createTeamWithAdmin('+15551230024');

    const requestResponse = await app.inject({
      method: 'POST',
      url: '/auth/otp/request',
      payload: { phone: '+15551230024' },
    });
    const { challengeId } = requestResponse.json();
    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/auth/otp/verify',
      payload: { challengeId, code: otpProvider.lastCode },
    });
    const { sessionToken } = verifyResponse.json();

    const beforeLogout = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/invites`,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { phone: '+15551230025' },
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
      url: `/teams/${teamId}/invites`,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { phone: '+15551230026' },
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
