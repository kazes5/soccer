import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
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
});
