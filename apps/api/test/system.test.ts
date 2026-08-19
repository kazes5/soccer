import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { generateSessionToken, hashSecret } from '../src/lib/crypto';
import { hashPassword } from '../src/lib/passwords';

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
      hasPassword?: boolean;
      isActive?: boolean;
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
        ...(options.hasPassword
          ? {
              passwordCredential: {
                create: { passwordHash: await hashPassword('Cedar-River!Otter-52') },
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
    const { token } = await createUser({ systemAdmin: true, hasPassword: true });

    const response = await disabledApp.inject({
      method: 'GET',
      url: '/system/overview',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: 'Not found.' });
  });

  it('does not let the global role bypass ordinary team membership checks', async () => {
    const { token } = await createUser({ systemAdmin: true, hasPassword: true });
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
      hasPassword: true,
    });
    const { user: member } = await createUser({ name: 'Visible Parent', hasPassword: false });
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
        expect.objectContaining({ id: actor.id, role: 'admin', hasPassword: true }),
        expect.objectContaining({ id: member.id, role: 'parent', hasPassword: false }),
      ]),
    );

    expect(users.statusCode).toBe(200);
    expect(users.json().users).toEqual([
      expect.objectContaining({ id: member.id, name: 'Visible Parent', membershipCount: 1 }),
    ]);
  });

  it('requires an active password owner, audits grant and revoke, and preserves the last admin', async () => {
    const { user: actor, token } = await createUser({
      systemAdmin: true,
      hasPassword: true,
    });
    const { user: target } = await createUser();
    const headers = { authorization: `Bearer ${token}` };
    const roleUrl = `/system/users/${target.id}/system-role`;

    const withoutPassword = await app.inject({
      method: 'PATCH',
      url: roleUrl,
      headers,
      payload: { systemRole: 'system_admin' },
    });
    expect(withoutPassword.statusCode).toBe(409);

    await app.prisma.passwordCredential.create({
      data: { userId: target.id, passwordHash: await hashPassword('Cedar-River!Otter-52') },
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
      hasPassword: true,
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
      hasPassword: true,
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
      hasPassword: true,
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

  it('lets a system admin create a team, add a member directly, and set a password for any user', async () => {
    const { token } = await createUser({ systemAdmin: true, hasPassword: true });
    const headers = { authorization: `Bearer ${token}` };

    const createTeamResponse = await app.inject({
      method: 'POST',
      url: '/system/teams',
      headers,
      payload: {
        teamName: `System-created team ${randomUUID()}`,
        season: 'Fall 2026',
        adminName: 'Founding Admin',
        adminEmail: `founding-${randomUUID()}@example.com`,
        adminPassword: 'Cedar-River!Otter-52',
        adminPasswordConfirmation: 'Cedar-River!Otter-52',
      },
    });
    expect(createTeamResponse.statusCode).toBe(201);
    const createdTeam = createTeamResponse.json();
    expect(createdTeam).not.toHaveProperty('sessionToken');
    createdTeamIds.push(createdTeam.team.id);
    createdUserIds.push(createdTeam.admin.id);

    const addMemberResponse = await app.inject({
      method: 'POST',
      url: `/system/teams/${createdTeam.team.id}/members`,
      headers,
      payload: {
        role: 'parent',
        name: 'Directly Added Parent',
        email: `direct-${randomUUID()}@example.com`,
        password: 'Cedar-River!Otter-52',
        passwordConfirmation: 'Cedar-River!Otter-52',
      },
    });
    expect(addMemberResponse.statusCode).toBe(201);
    const addedMember = addMemberResponse.json();
    createdUserIds.push(addedMember.id);
    expect(addedMember).toMatchObject({ role: 'parent', hasPassword: true });

    const setPasswordResponse = await app.inject({
      method: 'POST',
      url: `/system/users/${addedMember.id}/set-password`,
      headers,
      payload: {
        password: 'Willow-Harbor!Finch-81',
        passwordConfirmation: 'Willow-Harbor!Finch-81',
      },
    });
    expect(setPasswordResponse.statusCode).toBe(204);

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/auth/password/login',
      payload: {
        identifier: (await app.prisma.user.findUniqueOrThrow({ where: { id: addedMember.id } }))
          .email!,
        password: 'Cedar-River!Otter-52',
      },
    });
    expect(oldLogin.statusCode).toBe(401);
  });

  it('reactivates a previously-removed member with the same email instead of erroring', async () => {
    const { token } = await createUser({ systemAdmin: true, hasPassword: true });
    const headers = { authorization: `Bearer ${token}` };
    const team = await createTeam();
    const email = `rejoin-${randomUUID()}@example.com`;

    // DELETE /teams/:teamId/members/:userId is an ordinary team-scoped route
    // (CLAUDE.md §9.2: system_admin is never a bypass for /teams/*
    // authorization), so removing the reactivation target needs a real team
    // admin's session, not the system-admin token used everywhere else here.
    const teamAdmin = await app.inject({
      method: 'POST',
      url: `/system/teams/${team.id}/members`,
      headers,
      payload: {
        role: 'admin',
        name: 'Team Admin',
        email: `team-admin-${randomUUID()}@example.com`,
        password: 'Cedar-River!Otter-52',
        passwordConfirmation: 'Cedar-River!Otter-52',
      },
    });
    expect(teamAdmin.statusCode).toBe(201);
    const teamAdminId = teamAdmin.json().id as string;
    createdUserIds.push(teamAdminId);
    const teamAdminToken = generateSessionToken();
    await app.prisma.session.create({
      data: {
        userId: teamAdminId,
        tokenHash: hashSecret(teamAdminToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const first = await app.inject({
      method: 'POST',
      url: `/system/teams/${team.id}/members`,
      headers,
      payload: {
        role: 'parent',
        name: 'Original Name',
        email,
        password: 'Cedar-River!Otter-52',
        passwordConfirmation: 'Cedar-River!Otter-52',
      },
    });
    expect(first.statusCode).toBe(201);
    const firstUserId = first.json().id as string;
    createdUserIds.push(firstUserId);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/teams/${team.id}/members/${firstUserId}`,
      headers: { authorization: `Bearer ${teamAdminToken}` },
    });
    expect(removed.statusCode).toBe(204);

    const reactivated = await app.inject({
      method: 'POST',
      url: `/system/teams/${team.id}/members`,
      headers,
      payload: {
        role: 'admin',
        name: 'Rejoined Name',
        email,
        password: 'Willow-Harbor!Finch-81',
        passwordConfirmation: 'Willow-Harbor!Finch-81',
      },
    });
    expect(reactivated.statusCode).toBe(201);
    const body = reactivated.json();
    expect(body.id).toBe(firstUserId);
    expect(body).toMatchObject({ name: 'Rejoined Name', role: 'admin' });

    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: firstUserId } });
    expect(user.isActive).toBe(true);

    expect(
      await app.prisma.teamMember.count({
        where: { teamId: team.id, userId: firstUserId, role: 'admin' },
      }),
    ).toBe(1);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/password/login',
      payload: { identifier: email, password: 'Willow-Harbor!Finch-81' },
    });
    expect(login.statusCode).toBe(200);
  });
});
