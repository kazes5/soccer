import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { generateSessionToken, hashSecret } from '../src/lib/crypto';
import { RecordingOtpProvider } from './support/recording-otp-provider';

describe('team member management', () => {
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

  async function setUpTeamWithParent() {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPhone: `+1555125${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const teamBody = teamResponse.json();
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);
    const adminToken = teamBody.sessionToken as string;
    const teamId = teamBody.team.id as string;

    const inviteResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/invites`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { phone: `+1555126${Math.floor(Math.random() * 9000 + 1000)}` },
    });
    const invite = inviteResponse.json();

    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/accept`,
      payload: { name: 'Parent Two', language: 'en', players: [] },
    });
    const parentBody = acceptResponse.json();
    createdUserIds.push(parentBody.user.id);

    return { adminToken, teamId, parentUserId: parentBody.user.id as string };
  }

  it('lets an admin list team members', async () => {
    const { adminToken, teamId } = await setUpTeamWithParent();

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.members).toHaveLength(2);
    expect(body.members.map((m: { role: string }) => m.role).sort()).toEqual(['admin', 'parent']);
  });

  it('rejects a non-admin listing team members', async () => {
    const { teamId, parentUserId } = await setUpTeamWithParent();
    void parentUserId;

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/members`,
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('promotes a parent to admin', async () => {
    const { adminToken, teamId, parentUserId } = await setUpTeamWithParent();

    const response = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/members/${parentUserId}/role`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: 'admin' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ userId: parentUserId, role: 'admin' });

    const auditEntries = await app.prisma.auditLog.findMany({
      where: { teamId, actionType: 'member_promoted' },
    });
    expect(auditEntries).toHaveLength(1);
  });

  it('blocks demoting the last remaining admin', async () => {
    const { adminToken, teamId } = await setUpTeamWithParent();

    const teamResponse = await app.prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      include: { members: true },
    });
    const adminMembership = teamResponse.members.find((m) => m.role === 'admin')!;

    const response = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/members/${adminMembership.userId}/role`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: 'parent' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('blocks removing the last remaining admin', async () => {
    const { adminToken, teamId } = await setUpTeamWithParent();

    const teamResponse = await app.prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      include: { members: true },
    });
    const adminMembership = teamResponse.members.find((m) => m.role === 'admin')!;

    const response = await app.inject({
      method: 'DELETE',
      url: `/teams/${teamId}/members/${adminMembership.userId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(409);
  });

  it('removes a parent, revokes their login, and preserves their audit trail', async () => {
    const { adminToken, teamId, parentUserId } = await setUpTeamWithParent();

    const response = await app.inject({
      method: 'DELETE',
      url: `/teams/${teamId}/members/${parentUserId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(204);

    const membership = await app.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: parentUserId } },
    });
    expect(membership).toBeNull();

    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: parentUserId } });
    expect(user.isActive).toBe(false);

    const auditEntries = await app.prisma.auditLog.findMany({
      where: { teamId, actionType: 'member_removed', targetId: parentUserId },
    });
    expect(auditEntries).toHaveLength(1);
  });

  it('releases any shift the removed member held, back to open', async () => {
    const { adminToken, teamId, parentUserId } = await setUpTeamWithParent();

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
    const shiftId = sessionsResponse.json().sessions[0].points[0].shift.id as string;

    const parentToken = generateSessionToken();
    await app.prisma.session.create({
      data: {
        userId: parentUserId,
        tokenHash: hashSecret(parentToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/claim`,
      headers: { authorization: `Bearer ${parentToken}` },
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/teams/${teamId}/members/${parentUserId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(204);

    const shift = await app.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(shift.status).toBe('open');
    expect(shift.assignedUserId).toBeNull();

    const auditEntries = await app.prisma.auditLog.findMany({
      where: { teamId, actionType: 'shift_released', targetId: shiftId },
    });
    expect(auditEntries).toHaveLength(1);
  });
});
