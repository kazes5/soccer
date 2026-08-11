import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { FakeWebauthnVerifier } from './support/fake-webauthn-verifier';

describe('players', () => {
  const app = buildApp({ webauthnVerifier: new FakeWebauthnVerifier() });
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  async function setUpTeam() {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPhone: `+1555160${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const teamBody = teamResponse.json();
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);
    return { adminToken: teamBody.sessionToken as string, teamId: teamBody.team.id as string };
  }

  it('lists a team roster ordered by name', async () => {
    const { adminToken, teamId } = await setUpTeam();
    await app.prisma.player.createMany({
      data: [
        { teamId, name: 'Yossi Levi', age: 11 },
        { teamId, name: 'Alon Cohen', age: 9 },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/players`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().players).toEqual([
      expect.objectContaining({ name: 'Alon Cohen', age: 9 }),
      expect.objectContaining({ name: 'Yossi Levi', age: 11 }),
    ]);
  });

  it('is readable by a non-admin team member', async () => {
    const { adminToken, teamId } = await setUpTeam();
    const inviteResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/invites`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { phone: `+1555161${Math.floor(Math.random() * 9000 + 1000)}` },
    });
    const invite = inviteResponse.json() as { code: string };
    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/accept`,
      payload: { name: 'Avi Levi', players: [] },
    });
    createdUserIds.push(acceptResponse.json().user.id);

    const optionsResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/passkey/register/options`,
    });
    const { challengeId } = optionsResponse.json();
    const verifyResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/passkey/register/verify`,
      payload: { challengeId, response: { id: 'credential-avi-levi' } },
    });
    const { sessionToken } = verifyResponse.json() as { sessionToken: string };

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/players`,
      headers: { authorization: `Bearer ${sessionToken}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('rejects a caller who belongs to a different team', async () => {
    const { teamId: teamAId } = await setUpTeam();
    const { adminToken: teamBToken } = await setUpTeam();
    await app.prisma.player.create({ data: { teamId: teamAId, name: 'Someone Else', age: 10 } });

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamAId}/players`,
      headers: { authorization: `Bearer ${teamBToken}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects an unauthenticated caller', async () => {
    const { teamId } = await setUpTeam();

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/players`,
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    expect(response.statusCode).toBe(401);
  });
});
