import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { generateSessionToken, hashSecret } from '../src/lib/crypto';

describe('system administrator routes', () => {
  const app = buildApp({ systemAdminEnabled: true });
  const disabledApp = buildApp({ systemAdminEnabled: false });
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    await Promise.all([app.ready(), disabledApp.ready()]);
  });

  afterEach(async () => {
    await app.prisma.systemAuditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: createdUserIds } },
          { targetId: { in: [...createdUserIds, ...createdTeamIds] } },
          { teamId: { in: createdTeamIds } },
        ],
      },
    });
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  afterAll(async () => {
    await Promise.all([app.close(), disabledApp.close()]);
  });

  async function createUser(
    options: {
      name?: string;
      systemAdmin?: boolean;
      hasPasskey?: boolean;
      isActive?: boolean;
      authMethod?: 'passkey' | 'password';
    } = {},
  ) {
    const suffix = randomUUID();
    const user = await app.prisma.user.create({
      data: {
        name: options.name ?? `System test ${suffix}`,
        email: `${suffix}@system.test`,
        normalizedEmail: `${suffix}@system.test`,
        systemRole: options.systemAdmin ? 'system_admin' : null,
        isActive: options.isActive ?? true,
        ...(options.hasPasskey
          ? {
              passkeys: {
                create: {
                  credentialId: `credential-${suffix}`,
                  publicKey: Buffer.from('system-test-public-key'),
                  counter: 0,
                  transports: ['internal'],
                  deviceType: 'singleDevice',
                  backedUp: false,
                },
              },
            }
          : {}),
      },
    });
    createdUserIds.push(user.id);

    const token = generateSessionToken();
    await app.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashSecret(token),
        expiresAt: new Date(Date.now() + 60_000),
        authMethod: options.authMethod ?? 'passkey',
      },
    });
    return { user, token };
  }

  async function createTeam(name = `System team ${randomUUID()}`) {
    const team = await app.prisma.team.create({
      data: { name, season: 'Fall 2026', timezone: 'Asia/Jerusalem' },
    });
    createdTeamIds.push(team.id);
    return team;
  }

  it('returns 404 while the system-admin feature is disabled', async () => {
    const { token } = await createUser({ systemAdmin: true, hasPasskey: true });

    const response = await disabledApp.inject({
      method: 'GET',
      url: '/system/overview',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: 'Not found.' });
  });

  it('requires a privileged passkey session for system routes', async () => {
    const { token } = await createUser({
      systemAdmin: true,
      hasPasskey: true,
      authMethod: 'password',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/system/overview',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().message).toContain('passkey');
  });

  it('does not let the global role bypass ordinary team membership checks', async () => {
    const { token } = await createUser({ systemAdmin: true, hasPasskey: true });
    const team = await createTeam();

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${team.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).not.toHaveProperty('name');
  });

  it('shows the cross-team overview, team directory, members, and user directory', async () => {
    const { user: actor, token } = await createUser({
      name: 'Global Operator',
      systemAdmin: true,
      hasPasskey: true,
    });
    const { user: member } = await createUser({ name: 'Visible Parent', hasPasskey: false });
    const team = await createTeam('Visible Team');
    await app.prisma.teamMember.createMany({
      data: [
        { teamId: team.id, userId: member.id, role: 'parent' },
        { teamId: team.id, userId: actor.id, role: 'admin' },
      ],
    });
    const headers = { authorization: `Bearer ${token}` };

    const [overview, teams, members, users] = await Promise.all([
      app.inject({ method: 'GET', url: '/system/overview', headers }),
      app.inject({ method: 'GET', url: '/system/teams?search=Visible', headers }),
      app.inject({ method: 'GET', url: `/system/teams/${team.id}/members`, headers }),
      app.inject({ method: 'GET', url: '/system/users?search=Visible', headers }),
    ]);

    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toEqual(
      expect.objectContaining({
        teams: expect.any(Number),
        users: expect.any(Number),
        teamAdmins: expect.any(Number),
        systemAdmins: expect.any(Number),
      }),
    );
    expect(overview.json().systemAdmins).toBeGreaterThanOrEqual(1);

    expect(teams.statusCode).toBe(200);
    expect(teams.json().teams).toEqual([
      expect.objectContaining({
        id: team.id,
        name: 'Visible Team',
        memberCount: 2,
        adminCount: 1,
      }),
    ]);

    expect(members.statusCode).toBe(200);
    expect(members.json().members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: actor.id, role: 'admin', hasPasskey: true }),
        expect.objectContaining({ id: member.id, role: 'parent', hasPasskey: false }),
      ]),
    );

    expect(users.statusCode).toBe(200);
    expect(users.json().users).toEqual([
      expect.objectContaining({ id: member.id, name: 'Visible Parent', membershipCount: 1 }),
    ]);
  });

  it('requires an active passkey owner, audits grant and revoke, and preserves the last admin', async () => {
    const { user: actor, token } = await createUser({
      systemAdmin: true,
      hasPasskey: true,
    });
    const { user: target } = await createUser();
    const headers = { authorization: `Bearer ${token}` };
    const roleUrl = `/system/users/${target.id}/system-role`;

    const withoutPasskey = await app.inject({
      method: 'PATCH',
      url: roleUrl,
      headers,
      payload: { systemRole: 'system_admin' },
    });
    expect(withoutPasskey.statusCode).toBe(409);

    await app.prisma.passkey.create({
      data: {
        userId: target.id,
        credentialId: `credential-${randomUUID()}`,
        publicKey: Buffer.from('system-test-public-key'),
        counter: 0,
        transports: ['internal'],
        deviceType: 'singleDevice',
        backedUp: false,
      },
    });
    await app.prisma.user.update({ where: { id: target.id }, data: { isActive: false } });
    const inactive = await app.inject({
      method: 'PATCH',
      url: roleUrl,
      headers,
      payload: { systemRole: 'system_admin' },
    });
    expect(inactive.statusCode).toBe(409);

    await app.prisma.user.update({ where: { id: target.id }, data: { isActive: true } });
    const granted = await app.inject({
      method: 'PATCH',
      url: roleUrl,
      headers,
      payload: { systemRole: 'system_admin' },
    });
    expect(granted.statusCode).toBe(200);
    expect(granted.json()).toEqual({ id: target.id, systemRole: 'system_admin' });

    const revoked = await app.inject({
      method: 'PATCH',
      url: roleUrl,
      headers,
      payload: { systemRole: null },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toEqual({ id: target.id, systemRole: null });
    expect(await app.prisma.user.findUnique({ where: { id: target.id } })).toMatchObject({
      isActive: true,
    });

    const lastAdmin = await app.inject({
      method: 'PATCH',
      url: `/system/users/${actor.id}/system-role`,
      headers,
      payload: { systemRole: null },
    });
    expect(lastAdmin.statusCode).toBe(409);
    expect(
      await app.prisma.user.count({
        where: { id: actor.id, systemRole: 'system_admin', isActive: true },
      }),
    ).toBe(1);

    expect(
      await app.prisma.systemAuditLog.findMany({
        where: { actorId: actor.id, targetId: target.id },
        orderBy: { createdAt: 'asc' },
        select: { actionType: true },
      }),
    ).toEqual([{ actionType: 'system_admin_granted' }, { actionType: 'system_admin_revoked' }]);
  });

  it('changes a team role with normal side effects and makes a repeated no-op inert', async () => {
    const { token } = await createUser({
      systemAdmin: true,
      hasPasskey: true,
    });
    const { user: teamAdmin } = await createUser({ name: 'Team Admin' });
    const { user: parent } = await createUser({ name: 'Promoted Parent' });
    const team = await createTeam();
    await app.prisma.teamMember.createMany({
      data: [
        { teamId: team.id, userId: teamAdmin.id, role: 'admin' },
        { teamId: team.id, userId: parent.id, role: 'parent' },
      ],
    });
    const headers = { authorization: `Bearer ${token}` };

    const lastTeamAdmin = await app.inject({
      method: 'PATCH',
      url: `/system/teams/${team.id}/members/${teamAdmin.id}/role`,
      headers,
      payload: { role: 'parent' },
    });
    expect(lastTeamAdmin.statusCode).toBe(409);

    const promoted = await app.inject({
      method: 'PATCH',
      url: `/system/teams/${team.id}/members/${parent.id}/role`,
      headers,
      payload: { role: 'admin' },
    });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json()).toEqual({ userId: parent.id, role: 'admin' });

    const beforeNoOp = {
      teamAudits: await app.prisma.auditLog.count({ where: { teamId: team.id } }),
      systemAudits: await app.prisma.systemAuditLog.count({ where: { teamId: team.id } }),
      outbox: await app.prisma.outboxEvent.count({ where: { teamId: team.id } }),
    };
    expect(beforeNoOp).toEqual({ teamAudits: 1, systemAudits: 1, outbox: 1 });

    const noOp = await app.inject({
      method: 'PATCH',
      url: `/system/teams/${team.id}/members/${parent.id}/role`,
      headers,
      payload: { role: 'admin' },
    });
    expect(noOp.statusCode).toBe(200);
    expect(noOp.json()).toEqual({ userId: parent.id, role: 'admin' });
    expect({
      teamAudits: await app.prisma.auditLog.count({ where: { teamId: team.id } }),
      systemAudits: await app.prisma.systemAuditLog.count({ where: { teamId: team.id } }),
      outbox: await app.prisma.outboxEvent.count({ where: { teamId: team.id } }),
    }).toEqual(beforeNoOp);
  });

  it('keeps a system admin active and logged in after leaving their last team', async () => {
    const { user: teamAdmin, token: teamAdminToken } = await createUser({ name: 'Team Admin' });
    const { user: sysAdmin, token: sysAdminToken } = await createUser({
      name: 'Global Operator',
      systemAdmin: true,
      hasPasskey: true,
    });
    const team = await createTeam();
    await app.prisma.teamMember.createMany({
      data: [
        { teamId: team.id, userId: teamAdmin.id, role: 'admin' },
        { teamId: team.id, userId: sysAdmin.id, role: 'parent' },
      ],
    });

    const removal = await app.inject({
      method: 'DELETE',
      url: `/teams/${team.id}/members/${sysAdmin.id}`,
      headers: { authorization: `Bearer ${teamAdminToken}` },
    });
    expect(removal.statusCode).toBe(204);

    // Unlike an ordinary member losing their last membership, a system
    // admin's account stays active and their session stays valid — their
    // access is governed by the global role, not team membership.
    expect(await app.prisma.user.findUniqueOrThrow({ where: { id: sysAdmin.id } })).toMatchObject({
      isActive: true,
    });
    expect(
      await app.prisma.session.count({
        where: { userId: sysAdmin.id, revokedAt: null },
      }),
    ).toBeGreaterThan(0);

    const stillWorks = await app.inject({
      method: 'GET',
      url: '/system/overview',
      headers: { authorization: `Bearer ${sysAdminToken}` },
    });
    expect(stillWorks.statusCode).toBe(200);
  });

  it('lists global audit entries for a system admin, denies everyone else, and has no route that can alter one', async () => {
    const { user: actor, token } = await createUser({
      name: 'Global Operator',
      systemAdmin: true,
      hasPasskey: true,
    });
    const { token: parentToken } = await createUser();
    const entry = await app.prisma.systemAuditLog.create({
      data: {
        actorId: actor.id,
        actionType: 'system_admin_granted',
        targetEntity: 'user',
        targetId: actor.id,
        afterState: { systemRole: 'system_admin' },
      },
    });

    const asSystemAdmin = await app.inject({
      method: 'GET',
      url: '/system/audit-logs',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(asSystemAdmin.statusCode).toBe(200);
    expect(asSystemAdmin.json().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: entry.id,
          actorName: actor.name,
          actionType: 'system_admin_granted',
        }),
      ]),
    );

    const asOrdinaryParent = await app.inject({
      method: 'GET',
      url: '/system/audit-logs',
      headers: { authorization: `Bearer ${parentToken}` },
    });
    expect(asOrdinaryParent.statusCode).toBe(403);

    // CLAUDE.md §5.1: the log is read-only by construction — no route exists
    // to alter a global audit entry either, at any privilege level.
    const patchAttempt = await app.inject({
      method: 'PATCH',
      url: `/system/audit-logs/${entry.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { actionType: 'tampered' },
    });
    const deleteAttempt = await app.inject({
      method: 'DELETE',
      url: `/system/audit-logs/${entry.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(patchAttempt.statusCode).toBe(404);
    expect(deleteAttempt.statusCode).toBe(404);
    expect(await app.prisma.systemAuditLog.findUniqueOrThrow({ where: { id: entry.id } })).toEqual(
      entry,
    );
  });
});
