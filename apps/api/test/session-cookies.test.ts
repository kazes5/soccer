import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { getCookie } from './support/cookies';
import { RecordingOtpProvider } from './support/recording-otp-provider';

describe('cookie-based sessions and CSRF', () => {
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

  it('sets an httpOnly session cookie and a readable CSRF cookie on team creation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPhone: '+15551240001',
      },
    });
    const body = response.json();
    createdTeamIds.push(body.team.id);
    createdUserIds.push(body.admin.id);

    const sessionCookie = response.cookies.find((c) => c.name === 'soccer_session');
    const csrfCookie = response.cookies.find((c) => c.name === 'soccer_csrf');
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(csrfCookie?.httpOnly).toBeFalsy();
    expect(csrfCookie?.value).toBeTruthy();
  });

  async function loginWithCookies(phone: string) {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPhone: phone,
      },
    });
    const teamBody = teamResponse.json();
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);

    const requestResponse = await app.inject({
      method: 'POST',
      url: '/auth/otp/request',
      payload: { phone },
    });
    const { challengeId } = requestResponse.json();

    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/auth/otp/verify',
      payload: { challengeId, code: otpProvider.lastCode },
    });

    const sessionToken = getCookie(verifyResponse, 'soccer_session')!;
    const csrfToken = getCookie(verifyResponse, 'soccer_csrf')!;
    const cookieHeader = `soccer_session=${sessionToken}; soccer_csrf=${csrfToken}`;
    return { cookieHeader, csrfToken, teamId: teamBody.team.id };
  }

  it('authenticates a cookie-only request with no Authorization header', async () => {
    const { cookieHeader, csrfToken, teamId } = await loginWithCookies('+15551240002');

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/invites`,
      headers: { cookie: cookieHeader, 'x-csrf-token': csrfToken },
      payload: { phone: '+15551240003' },
    });

    expect(response.statusCode).toBe(201);
  });

  it('rejects a cookie-authenticated mutation missing the CSRF header', async () => {
    const { cookieHeader, teamId } = await loginWithCookies('+15551240004');

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/invites`,
      headers: { cookie: cookieHeader },
      payload: { phone: '+15551240005' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects a cookie-authenticated mutation with a CSRF header that does not match the cookie', async () => {
    const { cookieHeader, teamId } = await loginWithCookies('+15551240006');

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/invites`,
      headers: { cookie: cookieHeader, 'x-csrf-token': 'wrong-token' },
      payload: { phone: '+15551240007' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('does not require CSRF headers for bearer-token requests', async () => {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPhone: '+15551240008',
      },
    });
    const teamBody = teamResponse.json();
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamBody.team.id}/invites`,
      headers: { authorization: `Bearer ${teamBody.sessionToken}` },
      payload: { phone: '+15551240009' },
    });

    expect(response.statusCode).toBe(201);
  });

  it('GET /auth/me returns the current user and clears cookies on logout', async () => {
    const { cookieHeader, csrfToken } = await loginWithCookies('+15551240010');

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: cookieHeader },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ name: 'Dana Cohen', phone: '+15551240010' });

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: cookieHeader, 'x-csrf-token': csrfToken },
    });
    expect(logout.statusCode).toBe(204);
    const clearedSession = logout.cookies.find((c) => c.name === 'soccer_session');
    expect(clearedSession?.value).toBe('');

    const meAfterLogout = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: cookieHeader },
    });
    expect(meAfterLogout.statusCode).toBe(401);
  });
});
