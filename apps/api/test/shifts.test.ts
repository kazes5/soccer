import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { generateSessionToken, hashSecret } from '../src/lib/crypto';
import { RecordingOtpProvider } from './support/recording-otp-provider';

describe('shifts', () => {
  const otpProvider = new RecordingOtpProvider();
  const app = buildApp({ otpProvider });
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  // Accepting an invite creates the account but, per the real login flow, does not
  // by itself grant a session — a parent must separately complete OTP login. That
  // endpoint is rate-limited (10 requests/IP/hour by default), which `app.inject()`
  // would blow through immediately if used to log in every parent this file needs
  // (up to 10 at once, for the concurrency test below). So a session is created
  // directly here, exactly as `POST /auth/otp/verify` does internally, bypassing
  // only the rate-limited OTP step — not the session/auth mechanism itself.
  async function addParent(teamId: string, adminToken: string) {
    const inviteResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/invites`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { phone: `+1555160${Math.floor(Math.random() * 900000 + 100000)}` },
    });
    const invite = inviteResponse.json();

    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/accept`,
      payload: { name: 'Parent', language: 'en', players: [] },
    });
    const parentBody = acceptResponse.json();
    createdUserIds.push(parentBody.user.id);

    const sessionToken = generateSessionToken();
    await app.prisma.session.create({
      data: {
        userId: parentBody.user.id,
        tokenHash: hashSecret(sessionToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return { userId: parentBody.user.id as string, sessionToken };
  }

  async function setUpTeamWithShift() {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPhone: `+1555170${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const teamBody = teamResponse.json();
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);
    const adminToken = teamBody.sessionToken as string;
    const teamId = teamBody.team.id as string;

    const point = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/collection-points`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Oak St', address: '123 Oak St', type: 'pickup' },
    });

    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-templates`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        startDate: '2026-08-10',
        defaultTime: '18:00',
        defaultFieldLocation: 'Central Field',
        horizonWeeks: 1,
        collectionPointIds: [point.json().id],
      },
    });

    const sessionsResponse = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/sessions`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const session = sessionsResponse.json().sessions[0] as {
      id: string;
      points: Array<{ shift: { id: string } }>;
    };

    return {
      adminToken,
      teamId,
      sessionId: session.id,
      shiftId: session.points[0]!.shift.id,
    };
  }

  it('lets a parent claim an open shift', async () => {
    const { adminToken, teamId, shiftId } = await setUpTeamWithShift();
    const parent = await addParent(teamId, adminToken);

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/claim`,
      headers: { authorization: `Bearer ${parent.sessionToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('claimed');
    expect(body.assignedUserId).toBe(parent.userId);
    expect(body.version).toBe(1);

    const auditEntries = await app.prisma.auditLog.findMany({
      where: { teamId, actionType: 'shift_claimed' },
    });
    expect(auditEntries).toHaveLength(1);
  });

  it('returns a friendly conflict with the holder name when claiming an already-claimed shift', async () => {
    const { adminToken, teamId, shiftId } = await setUpTeamWithShift();
    const first = await addParent(teamId, adminToken);
    const second = await addParent(teamId, adminToken);

    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/claim`,
      headers: { authorization: `Bearer ${first.sessionToken}` },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/claim`,
      headers: { authorization: `Bearer ${second.sessionToken}` },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ holderName: 'Parent' });
  });

  it('lets the holder release their shift', async () => {
    const { adminToken, teamId, shiftId } = await setUpTeamWithShift();
    const parent = await addParent(teamId, adminToken);

    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/claim`,
      headers: { authorization: `Bearer ${parent.sessionToken}` },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/release`,
      headers: { authorization: `Bearer ${parent.sessionToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('open');
    expect(body.assignedUserId).toBeNull();
    expect(body.version).toBe(2);
  });

  it('rejects releasing a shift on a session that has since been cancelled', async () => {
    const { adminToken, teamId, sessionId, shiftId } = await setUpTeamWithShift();
    const parent = await addParent(teamId, adminToken);

    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/claim`,
      headers: { authorization: `Bearer ${parent.sessionToken}` },
    });
    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/sessions/${sessionId}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/release`,
      headers: { authorization: `Bearer ${parent.sessionToken}` },
    });

    expect(response.statusCode).toBe(409);
    const shift = await app.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(shift.status).toBe('claimed');
  });

  it('rejects releasing a shift you do not hold', async () => {
    const { adminToken, teamId, shiftId } = await setUpTeamWithShift();
    const first = await addParent(teamId, adminToken);
    const second = await addParent(teamId, adminToken);

    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/claim`,
      headers: { authorization: `Bearer ${first.sessionToken}` },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/release`,
      headers: { authorization: `Bearer ${second.sessionToken}` },
    });

    expect(response.statusCode).toBe(409);
  });

  it('yields exactly one success out of ten concurrent claims on the same shift', async () => {
    const { adminToken, teamId, shiftId } = await setUpTeamWithShift();
    const parents = await Promise.all(
      Array.from({ length: 10 }, () => addParent(teamId, adminToken)),
    );

    const responses = await Promise.all(
      parents.map((parent) =>
        app.inject({
          method: 'POST',
          url: `/teams/${teamId}/shifts/${shiftId}/claim`,
          headers: { authorization: `Bearer ${parent.sessionToken}` },
        }),
      ),
    );

    const successes = responses.filter((r) => r.statusCode === 200);
    const conflicts = responses.filter((r) => r.statusCode === 409);
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(9);

    const shift = await app.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(shift.status).toBe('claimed');
    expect(shift.version).toBe(1);

    const auditEntries = await app.prisma.auditLog.findMany({
      where: { teamId, actionType: 'shift_claimed', targetId: shiftId },
    });
    expect(auditEntries).toHaveLength(1);
  });
});
