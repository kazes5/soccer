import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { generateSessionToken, hashSecret } from '../src/lib/crypto';

describe('team audit logs', () => {
  const app = buildApp();
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  async function setUpTeam() {
    const response = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPassword: 'Cedar-River!Otter-52',
        adminPasswordConfirmation: 'Cedar-River!Otter-52',
        adminPhone: `+1555432${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const body = response.json();
    await app.prisma.auditLog.deleteMany({ where: { teamId: body.team.id } });
    createdTeamIds.push(body.team.id);
    createdUserIds.push(body.admin.id);
    return {
      adminId: body.admin.id as string,
      adminToken: body.sessionToken as string,
      teamId: body.team.id as string,
    };
  }

  async function createParent(teamId: string) {
    const parent = await app.prisma.user.create({
      data: {
        name: 'Parent Two',
        phone: `+1555433${Math.floor(Math.random() * 9000 + 1000)}`,
        teamMemberships: { create: { teamId, role: 'parent' } },
      },
    });
    createdUserIds.push(parent.id);
    const token = generateSessionToken();
    await app.prisma.session.create({
      data: {
        userId: parent.id,
        tokenHash: hashSecret(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    return { parent, token };
  }

  async function seedLogs(teamId: string, adminId: string) {
    const oldest = await app.prisma.auditLog.create({
      data: {
        teamId,
        actorId: adminId,
        actionType: 'member_promoted',
        targetEntity: 'team_member',
        targetId: 'target-hebrew',
        beforeState: { role: 'parent', note: 'שלום' },
        afterState: { role: 'admin' },
        source: 'app',
        createdAt: new Date('2026-08-10T08:00:00.000Z'),
      },
    });
    const newest = await app.prisma.auditLog.create({
      data: {
        teamId,
        actorId: adminId,
        actionType: 'schedule_template_updated',
        targetEntity: 'schedule_template',
        targetId: 'target-schedule',
        beforeState: { defaultTime: '17:00' },
        afterState: { defaultTime: '18:00' },
        source: 'ai_chat',
        createdAt: new Date('2026-08-11T08:00:00.000Z'),
      },
    });
    return { newest, oldest };
  }

  it('lists only the requested team newest-first and paginates with a cursor', async () => {
    const { adminId, adminToken, teamId } = await setUpTeam();
    const { newest, oldest } = await seedLogs(teamId, adminId);
    const otherTeam = await setUpTeam();
    await app.prisma.auditLog.create({
      data: {
        teamId: otherTeam.teamId,
        actorId: otherTeam.adminId,
        actionType: 'private_other_team_action',
        targetEntity: 'team',
      },
    });

    const first = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/audit-logs?limit=1`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      entries: [
        {
          id: newest.id,
          teamId,
          actor: { id: adminId, name: 'Dana Cohen' },
          actionType: 'schedule_template_updated',
          source: 'ai_chat',
        },
      ],
      nextCursor: newest.id,
    });

    const second = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/audit-logs?limit=1&cursor=${newest.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().entries.map((entry: { id: string }) => entry.id)).toEqual([oldest.id]);
    expect(second.json().nextCursor).toBeNull();
    expect(JSON.stringify([first.json(), second.json()])).not.toContain(
      'private_other_team_action',
    );
  });

  it('applies actor, date, action, target, source, and safe text search filters', async () => {
    const { adminId, adminToken, teamId } = await setUpTeam();
    await seedLogs(teamId, adminId);
    const base = `/teams/${teamId}/audit-logs`;
    const headers = { authorization: `Bearer ${adminToken}` };

    const queries = [
      '?actor=dana',
      '?from=2026-08-11T00%3A00%3A00.000Z&to=2026-08-12T00%3A00%3A00.000Z',
      '?action=schedule_template_updated',
      '?target=schedule_template',
      '?source=ai_chat',
      '?search=target-schedule',
    ];
    for (const query of queries) {
      const response = await app.inject({ method: 'GET', url: `${base}${query}`, headers });
      expect(response.statusCode).toBe(200);
      expect(response.json().entries).toHaveLength(query === '?actor=dana' ? 2 : 1);
    }

    const literalInjection = await app.inject({
      method: 'GET',
      url: `${base}?search=${encodeURIComponent("%' OR 1=1 --")}`,
      headers,
    });
    expect(literalInjection.statusCode).toBe(200);
    expect(literalInjection.json().entries).toEqual([]);
  });

  it('rejects unauthenticated, parent, and other-team callers', async () => {
    const { adminId, teamId } = await setUpTeam();
    await seedLogs(teamId, adminId);
    const { token: parentToken } = await createParent(teamId);
    const otherTeam = await setUpTeam();

    for (const token of [undefined, parentToken, otherTeam.adminToken]) {
      const response = await app.inject({
        method: 'GET',
        url: `/teams/${teamId}/audit-logs`,
        ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      });
      expect(response.statusCode).toBe(token ? 403 : 401);
    }
  });

  it('exports the same filtered team data as UTF-8-BOM CSV and neutralizes formulas', async () => {
    const { adminId, adminToken, teamId } = await setUpTeam();
    await seedLogs(teamId, adminId);
    await app.prisma.auditLog.create({
      data: {
        teamId,
        actorId: adminId,
        actionType: '=WEBSERVICE("https://example.invalid")',
        targetEntity: 'team',
        afterState: { label: 'עברית' },
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/audit-logs/export?target=team`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.body.charCodeAt(0)).toBe(0xfeff);
    expect(response.body).toContain('עברית');
    expect(response.body).toContain("'=WEBSERVICE");
    expect(response.body).not.toContain('member_promoted');
  });

  it('has no route that can modify or delete an audit log entry, even for an admin', async () => {
    const { adminId, adminToken, teamId } = await setUpTeam();
    const { oldest: entry } = await seedLogs(teamId, adminId);

    const patchAttempt = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/audit-logs/${entry.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { actionType: 'tampered' },
    });
    const deleteAttempt = await app.inject({
      method: 'DELETE',
      url: `/teams/${teamId}/audit-logs/${entry.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    // CLAUDE.md §5.1: the log is read-only by construction — no route exists
    // to alter it, for anyone, at any privilege level. A 404 here (route not
    // found) is the desired outcome, not a 403 (route exists but denied).
    expect(patchAttempt.statusCode).toBe(404);
    expect(deleteAttempt.statusCode).toBe(404);
    expect(await app.prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).toEqual(entry);
  });
});
