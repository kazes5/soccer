import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { FakeWebauthnVerifier } from './support/fake-webauthn-verifier';

async function createTeamWithAdmin(app: FastifyInstance, adminPhone: string) {
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
  const body = response.json() as {
    team: { id: string };
    admin: { id: string };
    sessionToken: string;
  };
  return { teamId: body.team.id, adminId: body.admin.id, sessionToken: body.sessionToken };
}

async function createInvite(
  app: FastifyInstance,
  teamId: string,
  sessionToken: string,
  phone: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: `/teams/${teamId}/invites`,
    headers: { authorization: `Bearer ${sessionToken}` },
    payload: { phone },
  });
  return response.json() as { id: string; code: string };
}

describe('POST /invites/:code/accept', () => {
  const app = buildApp({ webauthnVerifier: new FakeWebauthnVerifier() });
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  it('creates the invited parent, links players, and marks the invite accepted', async () => {
    const { teamId, adminId, sessionToken } = await createTeamWithAdmin(app, '+15551230100');
    createdTeamIds.push(teamId);
    createdUserIds.push(adminId);
    const invite = await createInvite(app, teamId, sessionToken, '+15551230101');

    const response = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/accept`,
      payload: {
        name: 'Avi Levi',
        players: [{ name: 'Yossi Levi', age: 11 }],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    createdUserIds.push(body.user.id);
    expect(body.user).toMatchObject({ name: 'Avi Levi', phone: '+15551230101' });
    expect(body.team).toMatchObject({ id: teamId, name: 'U-12 Wildcats' });
    expect(body.players).toEqual([expect.objectContaining({ name: 'Yossi Levi', age: 11 })]);

    const membership = await app.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: body.user.id } },
    });
    expect(membership?.role).toBe('parent');

    const updatedInvite = await app.prisma.invite.findUnique({ where: { code: invite.code } });
    expect(updatedInvite?.status).toBe('accepted');

    const outboxEvents = await app.prisma.outboxEvent.findMany({
      where: { teamId, eventType: 'invite_accepted' },
    });
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]).toMatchObject({
      category: 'admin_changes',
      recipientScope: 'team_broadcast',
    });
    expect(outboxEvents[0]?.payload).toMatchObject({ userId: body.user.id, userName: 'Avi Levi' });
  });

  it('lets the newly registered parent complete passkey registration afterward', async () => {
    const { teamId, adminId, sessionToken } = await createTeamWithAdmin(app, '+15551230102');
    createdTeamIds.push(teamId);
    createdUserIds.push(adminId);
    const invite = await createInvite(app, teamId, sessionToken, '+15551230103');

    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/accept`,
      payload: { name: 'Sarah Katz' },
    });
    createdUserIds.push(acceptResponse.json().user.id);

    const optionsResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/passkey/register/options`,
    });
    expect(optionsResponse.statusCode).toBe(201);
    const { challengeId } = optionsResponse.json();

    const verifyResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/passkey/register/verify`,
      payload: { challengeId, response: { id: 'credential-sarah-katz' } },
    });
    expect(verifyResponse.statusCode).toBe(200);
    expect(typeof verifyResponse.json().sessionToken).toBe('string');
  });

  it('rejects accepting the same invite twice', async () => {
    const { teamId, adminId, sessionToken } = await createTeamWithAdmin(app, '+15551230104');
    createdTeamIds.push(teamId);
    createdUserIds.push(adminId);
    const invite = await createInvite(app, teamId, sessionToken, '+15551230105');

    const first = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/accept`,
      payload: { name: 'Avi Levi' },
    });
    createdUserIds.push(first.json().user.id);

    const second = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/accept`,
      payload: { name: 'Avi Levi' },
    });

    expect(second.statusCode).toBe(409);
  });

  it('lets an admin re-invite an existing member for account recovery, without duplicating membership or players', async () => {
    const { teamId, adminId, sessionToken } = await createTeamWithAdmin(app, '+15551230106');
    createdTeamIds.push(teamId);
    createdUserIds.push(adminId);

    const firstInvite = await createInvite(app, teamId, sessionToken, '+15551230107');
    const firstAccept = await app.inject({
      method: 'POST',
      url: `/invites/${firstInvite.code}/accept`,
      payload: { name: 'Avi Levi', players: [{ name: 'Yossi Levi', age: 11 }] },
    });
    const userId = firstAccept.json().user.id as string;
    createdUserIds.push(userId);

    // Simulate a lost device: the admin generates a *second*, fresh invite
    // for the same phone number, per the recovery model in CLAUDE.md §9.1.
    const recoveryInvite = await createInvite(app, teamId, sessionToken, '+15551230107');
    const recoveryAccept = await app.inject({
      method: 'POST',
      url: `/invites/${recoveryInvite.code}/accept`,
      payload: { name: 'Avi Levi', players: [{ name: 'Someone Else', age: 9 }] },
    });

    expect(recoveryAccept.statusCode).toBe(201);
    const body = recoveryAccept.json();
    expect(body.user.id).toBe(userId);
    // The submitted "Someone Else" player is ignored — recovery re-anchors the
    // existing account, it doesn't create new players.
    expect(body.players).toEqual([expect.objectContaining({ name: 'Yossi Levi', age: 11 })]);

    const memberships = await app.prisma.teamMember.findMany({ where: { teamId, userId } });
    expect(memberships).toHaveLength(1);
    const players = await app.prisma.player.findMany({ where: { teamId, name: 'Someone Else' } });
    expect(players).toHaveLength(0);

    const updatedRecoveryInvite = await app.prisma.invite.findUniqueOrThrow({
      where: { code: recoveryInvite.code },
    });
    expect(updatedRecoveryInvite.status).toBe('accepted');
    expect(updatedRecoveryInvite.acceptedByUserId).toBe(userId);

    // The recovery accept lets the same user complete passkey registration
    // again, scoped to the new invite code — this is the actual point of the
    // recovery flow (a fresh credential on a new/current device).
    const optionsResponse = await app.inject({
      method: 'POST',
      url: `/invites/${recoveryInvite.code}/passkey/register/options`,
    });
    expect(optionsResponse.statusCode).toBe(201);

    const auditEntries = await app.prisma.auditLog.findMany({
      where: { teamId, actionType: 'invite_accepted_for_recovery', targetId: recoveryInvite.id },
    });
    expect(auditEntries).toHaveLength(1);

    // The recovery path doesn't change team composition (the user was
    // already a member), so it's deliberately not notification-worthy —
    // only the original, genuinely-new-membership accept above is.
    const recoveryOutboxEvents = await app.prisma.outboxEvent.findMany({
      where: {
        teamId,
        eventType: 'invite_accepted',
        payload: { path: ['userId'], equals: userId },
      },
    });
    expect(recoveryOutboxEvents).toHaveLength(1);
  });

  it('onboards an existing parent to a second invited team and returns both memberships', async () => {
    const firstTeam = await createTeamWithAdmin(app, '+15551230108');
    const secondTeam = await createTeamWithAdmin(app, '+15551230109');
    createdTeamIds.push(firstTeam.teamId, secondTeam.teamId);
    createdUserIds.push(firstTeam.adminId, secondTeam.adminId);

    const parentPhone = '+15551230110';
    const firstInvite = await createInvite(
      app,
      firstTeam.teamId,
      firstTeam.sessionToken,
      parentPhone,
    );
    const firstAccept = await app.inject({
      method: 'POST',
      url: `/invites/${firstInvite.code}/accept`,
      payload: { name: 'Multi Team Parent', players: [{ name: 'First Player' }] },
    });
    expect(firstAccept.statusCode).toBe(201);
    const parentUserId = firstAccept.json().user.id as string;
    createdUserIds.push(parentUserId);

    const secondInvite = await createInvite(
      app,
      secondTeam.teamId,
      secondTeam.sessionToken,
      parentPhone,
    );
    const secondAccept = await app.inject({
      method: 'POST',
      url: `/invites/${secondInvite.code}/accept`,
      payload: { name: 'Multi Team Parent', players: [{ name: 'Second Player' }] },
    });

    expect(secondAccept.statusCode).toBe(201);
    expect(secondAccept.json().user.id).toBe(parentUserId);

    const memberships = await app.prisma.teamMember.findMany({
      where: { userId: parentUserId },
      orderBy: { teamId: 'asc' },
    });
    expect(memberships).toHaveLength(2);
    expect(memberships.map((membership) => membership.teamId).sort()).toEqual(
      [firstTeam.teamId, secondTeam.teamId].sort(),
    );
    expect(memberships.every((membership) => membership.role === 'parent')).toBe(true);

    const optionsResponse = await app.inject({
      method: 'POST',
      url: `/invites/${secondInvite.code}/passkey/register/options`,
    });
    expect(optionsResponse.statusCode).toBe(201);
    const verifyResponse = await app.inject({
      method: 'POST',
      url: `/invites/${secondInvite.code}/passkey/register/verify`,
      payload: {
        challengeId: optionsResponse.json().challengeId,
        response: { id: 'credential-multi-team-parent' },
      },
    });

    expect(verifyResponse.statusCode).toBe(200);
    expect(
      verifyResponse
        .json()
        .teamMemberships.map((membership: { teamId: string }) => membership.teamId)
        .sort(),
    ).toEqual([firstTeam.teamId, secondTeam.teamId].sort());
  });

  it('rejects an unknown invite code', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/invites/does-not-exist/accept',
      payload: { name: 'Avi Levi' },
    });

    expect(response.statusCode).toBe(404);
  });
});
