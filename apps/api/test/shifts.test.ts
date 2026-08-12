import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { generateSessionToken, hashSecret } from '../src/lib/crypto';
import { futureMondayDateString } from './support/dates';

describe('shifts', () => {
  const app = buildApp();
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  // Accepting an invite creates the account but, per the real onboarding flow, does
  // not by itself grant a session — a parent must separately complete passkey
  // registration. That requires an actual browser/authenticator ceremony this file
  // has no need to simulate (it's exercised directly in auth.test.ts via
  // FakeWebauthnVerifier), so a session is created directly here — up to 10 at
  // once, for the concurrency test below — exactly as the real registration/login
  // endpoints do internally, bypassing only the ceremony, not the session mechanism.
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
        startDate: futureMondayDateString(1),
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

  // A 'both'-type point over two sessions/week yields both a to_practice and a
  // from_practice shift per session — needed to exercise per-direction stats,
  // unlike setUpTeamWithShift's single 'pickup' point (to_practice only).
  async function setUpTeamWithBothDirectionShifts() {
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
      payload: { name: 'Oak St', address: '123 Oak St', type: 'both' },
    });

    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-templates`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE',
        startDate: futureMondayDateString(1),
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
    const sessions = sessionsResponse.json().sessions as Array<{
      id: string;
      points: Array<{ shift: { id: string; direction: string } }>;
    }>;

    return { adminToken, teamId, sessions };
  }

  function shiftIdFor(
    sessions: Array<{ id: string; points: Array<{ shift: { id: string; direction: string } }> }>,
    sessionIndex: number,
    direction: string,
  ) {
    const shift = sessions[sessionIndex]!.points.map((p) => p.shift).find(
      (s) => s.direction === direction,
    );
    if (!shift) throw new Error(`No ${direction} shift on session ${sessionIndex}`);
    return shift.id;
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

    const outboxEvents = await app.prisma.outboxEvent.findMany({
      where: { teamId, eventType: 'shift_claimed' },
    });
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]).toMatchObject({
      category: 'shift_changes',
      recipientScope: 'team_broadcast',
      processedAt: null,
    });
    expect(outboxEvents[0]?.payload).toMatchObject({
      shiftId,
      pointName: 'Oak St',
      direction: 'to_practice',
      byUserName: 'Parent',
    });
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

    const outboxEvents = await app.prisma.outboxEvent.findMany({
      where: { teamId, eventType: 'shift_released' },
    });
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]?.payload).toMatchObject({ shiftId, reason: 'voluntary' });
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

  describe('GET /teams/:teamId/shifts/stats', () => {
    it("reports the caller's own counts by direction and the team average", async () => {
      const { adminToken, teamId, sessions } = await setUpTeamWithBothDirectionShifts();
      const parent = await addParent(teamId, adminToken);

      // Team has 2 members (admin + parent). Parent claims one to_practice and
      // one from_practice shift; nobody else claims anything.
      await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/shifts/${shiftIdFor(sessions, 0, 'to_practice')}/claim`,
        headers: { authorization: `Bearer ${parent.sessionToken}` },
      });
      await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/shifts/${shiftIdFor(sessions, 0, 'from_practice')}/claim`,
        headers: { authorization: `Bearer ${parent.sessionToken}` },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/teams/${teamId}/shifts/stats`,
        headers: { authorization: `Bearer ${parent.sessionToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.mine).toEqual({ toPractice: 1, fromPractice: 1, total: 2 });
      // 2 claimed shifts total / 2 team members = 1 average, per direction.
      expect(body.teamAverage).toEqual({ toPractice: 0.5, fromPractice: 0.5, total: 1 });
    });

    it("does not count another parent's claims toward the caller's own stats", async () => {
      const { adminToken, teamId, sessions } = await setUpTeamWithBothDirectionShifts();
      const parentA = await addParent(teamId, adminToken);
      const parentB = await addParent(teamId, adminToken);

      await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/shifts/${shiftIdFor(sessions, 0, 'to_practice')}/claim`,
        headers: { authorization: `Bearer ${parentA.sessionToken}` },
      });
      await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/shifts/${shiftIdFor(sessions, 0, 'from_practice')}/claim`,
        headers: { authorization: `Bearer ${parentB.sessionToken}` },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/teams/${teamId}/shifts/stats`,
        headers: { authorization: `Bearer ${parentA.sessionToken}` },
      });

      const body = response.json();
      expect(body.mine).toEqual({ toPractice: 1, fromPractice: 0, total: 1 });
      // 2 claimed shifts total / 3 team members (admin + 2 parents).
      expect(body.teamAverage.total).toBeCloseTo(2 / 3);
    });

    it('excludes shifts belonging to cancelled sessions from both mine and teamAverage', async () => {
      const { adminToken, teamId, sessions } = await setUpTeamWithBothDirectionShifts();
      const parent = await addParent(teamId, adminToken);

      await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/shifts/${shiftIdFor(sessions, 0, 'to_practice')}/claim`,
        headers: { authorization: `Bearer ${parent.sessionToken}` },
      });
      await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/shifts/${shiftIdFor(sessions, 1, 'to_practice')}/claim`,
        headers: { authorization: `Bearer ${parent.sessionToken}` },
      });
      await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/sessions/${sessions[1]!.id}/cancel`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/teams/${teamId}/shifts/stats`,
        headers: { authorization: `Bearer ${parent.sessionToken}` },
      });

      const body = response.json();
      expect(body.mine).toEqual({ toPractice: 1, fromPractice: 0, total: 1 });
      expect(body.teamAverage.toPractice).toBeCloseTo(1 / 2);
    });

    it('rejects a caller who is not a member of the team', async () => {
      const { teamId } = await setUpTeamWithBothDirectionShifts();
      const { teamId: otherTeamId, adminToken: otherAdminToken } =
        await setUpTeamWithBothDirectionShifts();
      expect(otherTeamId).not.toBe(teamId);

      const response = await app.inject({
        method: 'GET',
        url: `/teams/${teamId}/shifts/stats`,
        headers: { authorization: `Bearer ${otherAdminToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('rejects an unauthenticated caller', async () => {
      const { teamId } = await setUpTeamWithBothDirectionShifts();

      const response = await app.inject({
        method: 'GET',
        url: `/teams/${teamId}/shifts/stats`,
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
