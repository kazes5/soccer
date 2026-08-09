import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

describe('POST /teams', () => {
  const app = buildApp();
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  it('creates a team with its first admin and returns a session token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPhone: '+15551230001',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    createdTeamIds.push(body.team.id);
    createdUserIds.push(body.admin.id);

    expect(body.team).toMatchObject({ name: 'U-12 Wildcats', season: 'Fall 2026' });
    expect(body.admin).toMatchObject({ name: 'Dana Cohen', phone: '+15551230001' });
    expect(typeof body.sessionToken).toBe('string');

    const membership = await app.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: body.team.id, userId: body.admin.id } },
    });
    expect(membership?.role).toBe('admin');
  });

  it('rejects a request with no admin contact method', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: { teamName: 'U-12 Wildcats', season: 'Fall 2026', adminName: 'Dana Cohen' },
    });

    expect(response.statusCode).toBe(400);
  });
});
