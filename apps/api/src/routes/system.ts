import {
  createTeamRequestSchema,
  setPasswordRequestSchema,
  systemAddMemberRequestSchema,
  systemAuditListResponseSchema,
  systemCreateTeamResponseSchema,
  systemOverviewSchema,
  systemTeamListResponseSchema,
  systemTeamMemberListResponseSchema,
  systemUserListResponseSchema,
  updateMemberRoleRequestSchema,
  updateSystemRoleRequestSchema,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireSystemAdmin } from '../lib/authorization';
import { createOrReactivateTeamMember } from '../lib/direct-member';
import { HttpError } from '../lib/errors';
import { recordAuditLog } from '../lib/audit';
import { normalizeEmail, normalizePhone } from '../lib/identifiers';
import { assertAcceptablePassword, hashPassword } from '../lib/passwords';
import { recordOutboxEvent } from '../lib/outbox';
import { enqueueOutboxEventBestEffort } from '../lib/queues';
import { recordSystemAuditLog } from '../lib/system-audit';

const idParams = z.object({ id: z.string().uuid() });
const memberParams = z.object({ teamId: z.string().uuid(), userId: z.string().uuid() });
const teamParams = z.object({ teamId: z.string().uuid() });
const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

async function guard(app: FastifyInstance, request: Parameters<typeof requireAuth>[0]) {
  if (!app.systemAdminEnabled) throw new HttpError(404, 'Not found.');
  const currentUser = requireAuth(request);
  await requireSystemAdmin(app.prisma, currentUser);
  return currentUser;
}

export default async function systemRoutes(app: FastifyInstance) {
  app.get('/system/overview', async (request) => {
    await guard(app, request);
    const [teams, users, teamAdmins, systemAdmins] = await Promise.all([
      app.prisma.team.count(),
      app.prisma.user.count(),
      app.prisma.teamMember.count({ where: { role: 'admin' } }),
      app.prisma.user.count({ where: { systemRole: 'system_admin', isActive: true } }),
    ]);
    return systemOverviewSchema.parse({ teams, users, teamAdmins, systemAdmins });
  });

  app.get('/system/teams', async (request) => {
    await guard(app, request);
    const query = listQuery.parse(request.query);
    const teams = await app.prisma.team.findMany({
      where: query.search ? { name: { contains: query.search, mode: 'insensitive' } } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
      include: { _count: { select: { members: true } }, members: { select: { role: true } } },
    });
    const page = teams.slice(0, query.limit);
    return systemTeamListResponseSchema.parse({
      teams: page.map((team) => ({
        id: team.id,
        name: team.name,
        season: team.season,
        timezone: team.timezone,
        memberCount: team._count.members,
        adminCount: team.members.filter((member) => member.role === 'admin').length,
        createdAt: team.createdAt.toISOString(),
      })),
      nextCursor: teams.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    });
  });

  app.get('/system/teams/:id/members', async (request) => {
    await guard(app, request);
    const { id } = idParams.parse(request.params);
    const team = await app.prisma.team.findUnique({ where: { id }, select: { id: true } });
    if (!team) throw new HttpError(404, 'Team not found.');
    const members = await app.prisma.teamMember.findMany({
      where: { teamId: id },
      orderBy: { joinedAt: 'asc' },
      select: {
        role: true,
        joinedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            isActive: true,
            systemRole: true,
            passwordCredential: { select: { userId: true } },
          },
        },
      },
    });
    return systemTeamMemberListResponseSchema.parse({
      members: members.map(({ user, role, joinedAt }) => ({
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        isActive: user.isActive,
        systemRole: user.systemRole,
        hasPassword: user.passwordCredential !== null,
        role,
        joinedAt: joinedAt.toISOString(),
      })),
    });
  });

  app.get('/system/users', async (request) => {
    await guard(app, request);
    const query = listQuery.parse(request.query);
    const users = await app.prisma.user.findMany({
      where: query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
            ],
          }
        : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        isActive: true,
        systemRole: true,
        createdAt: true,
        passwordCredential: { select: { userId: true } },
        _count: { select: { teamMemberships: true } },
      },
    });
    const page = users.slice(0, query.limit);
    return systemUserListResponseSchema.parse({
      users: page.map((user) => ({
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        isActive: user.isActive,
        systemRole: user.systemRole,
        hasPassword: user.passwordCredential !== null,
        membershipCount: user._count.teamMemberships,
        createdAt: user.createdAt.toISOString(),
      })),
      nextCursor: users.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    });
  });

  app.get('/system/audit-logs', async (request) => {
    await guard(app, request);
    const query = listQuery.omit({ search: true }).parse(request.query);
    const entries = await app.prisma.systemAuditLog.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
      include: { actor: { select: { name: true } } },
    });
    const page = entries.slice(0, query.limit);
    return systemAuditListResponseSchema.parse({
      entries: page.map((entry) => ({
        id: entry.id,
        actorName: entry.actor?.name ?? null,
        actionType: entry.actionType,
        targetEntity: entry.targetEntity,
        targetId: entry.targetId,
        teamId: entry.teamId,
        beforeState: entry.beforeState,
        afterState: entry.afterState,
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor: entries.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    });
  });

  app.patch('/system/users/:id/system-role', async (request) => {
    const currentUser = await guard(app, request);
    const { id } = idParams.parse(request.params);
    const body = updateSystemRoleRequestSchema.parse(request.body);
    return app.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ locked: number }>>`
        SELECT 1::int AS locked FROM pg_advisory_xact_lock(74139201)
      `;
      const actor = await tx.user.findUnique({ where: { id: currentUser.id } });
      if (!actor?.isActive || actor.systemRole !== 'system_admin')
        throw new HttpError(403, 'System administrator access is required.');
      const target = await tx.user.findUnique({
        where: { id },
        include: { passwordCredential: true },
      });
      if (!target) throw new HttpError(404, 'User not found.');
      if (
        body.systemRole === 'system_admin' &&
        (!target.isActive || target.passwordCredential === null)
      ) {
        throw new HttpError(409, 'A system administrator must be active and have a password set.');
      }
      if (target.systemRole === body.systemRole)
        return { id: target.id, systemRole: target.systemRole };
      if (target.systemRole === 'system_admin' && body.systemRole === null) {
        const others = await tx.user.count({
          where: { systemRole: 'system_admin', isActive: true, id: { not: id } },
        });
        if (others === 0)
          throw new HttpError(
            409,
            'The system must always have at least one system administrator.',
          );
      }
      const changed = await tx.user.update({
        where: { id },
        data: { systemRole: body.systemRole },
      });
      await recordSystemAuditLog(tx, {
        actorId: currentUser.id,
        actionType: body.systemRole ? 'system_admin_granted' : 'system_admin_revoked',
        targetEntity: 'user',
        targetId: id,
        beforeState: { systemRole: target.systemRole },
        afterState: { systemRole: changed.systemRole },
      });
      return { id: changed.id, systemRole: changed.systemRole };
    });
  });

  app.patch('/system/teams/:teamId/members/:userId/role', async (request) => {
    const currentUser = await guard(app, request);
    const params = memberParams.parse(request.params);
    const body = updateMemberRoleRequestSchema.parse(request.body);
    const result = await app.prisma.$transaction(async (tx) => {
      // Global-role mutations and cross-team mutations share this lock order:
      // system authorization first, then the individual team row.
      await tx.$queryRaw<Array<{ locked: number }>>`
        SELECT 1::int AS locked FROM pg_advisory_xact_lock(74139201)
      `;
      const actor = await tx.user.findUnique({
        where: { id: currentUser.id },
        select: { isActive: true, systemRole: true },
      });
      if (!actor?.isActive || actor.systemRole !== 'system_admin') {
        throw new HttpError(403, 'System administrator access is required.');
      }
      await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "teams" WHERE "id" = ${params.teamId} FOR UPDATE`;
      const target = await tx.teamMember.findUnique({
        where: { teamId_userId: params },
        include: { user: { select: { name: true } } },
      });
      if (!target) throw new HttpError(404, 'This person is not on the team.');
      if (target.role === body.role) {
        return { response: { userId: target.userId, role: target.role }, outboxEventId: null };
      }
      if (target.role === 'admin' && body.role === 'parent') {
        const others = await tx.teamMember.count({
          where: { teamId: params.teamId, role: 'admin', userId: { not: params.userId } },
        });
        if (others === 0) throw new HttpError(409, 'A team must always have at least one admin.');
      }
      const changed = await tx.teamMember.update({
        where: { teamId_userId: params },
        data: { role: body.role },
      });
      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: body.role === 'admin' ? 'member_promoted' : 'member_demoted',
        targetEntity: 'team_member',
        targetId: params.userId,
        beforeState: { role: target.role },
        afterState: { role: changed.role },
      });
      await recordSystemAuditLog(tx, {
        actorId: currentUser.id,
        teamId: params.teamId,
        actionType: body.role === 'admin' ? 'member_promoted' : 'member_demoted',
        targetEntity: 'team_member',
        targetId: params.userId,
        beforeState: { role: target.role },
        afterState: { role: changed.role },
      });
      const outboxEvent = await recordOutboxEvent(tx, {
        teamId: params.teamId,
        eventType: body.role === 'admin' ? 'member_promoted' : 'member_demoted',
        category: 'admin_changes',
        recipientScope: { type: 'team_broadcast' },
        actorId: currentUser.id,
        payload: { userId: params.userId, userName: target.user.name },
      });
      return {
        response: { userId: changed.userId, role: changed.role },
        outboxEventId: outboxEvent.id,
      };
    });
    if (result.outboxEventId) {
      enqueueOutboxEventBestEffort(app.outboxQueue, result.outboxEventId);
    }
    return result.response;
  });

  // System admin creates a new team and its founding admin, with a password
  // of the system admin's own choosing. Doesn't log the system admin in as
  // that admin — they keep their own session — unlike the public self-serve
  // POST /teams, which does.
  app.post('/system/teams', async (request, reply) => {
    const currentUser = await guard(app, request);
    const body = createTeamRequestSchema.parse(request.body);
    const password = assertAcceptablePassword(body.adminPassword, [
      body.adminEmail ?? '',
      body.adminPhone ?? '',
    ]);
    const passwordHash = await hashPassword(password);

    const { team, admin } = await app.prisma.$transaction(async (tx) => {
      const createdTeam = await tx.team.create({
        data: { name: body.teamName, season: body.season, timezone: body.timezone },
      });
      const createdAdmin = await tx.user.create({
        data: {
          name: body.adminName,
          phone: body.adminPhone,
          email: body.adminEmail,
          normalizedPhone: body.adminPhone ? normalizePhone(body.adminPhone) : undefined,
          normalizedEmail: body.adminEmail ? normalizeEmail(body.adminEmail) : undefined,
          languagePreference: body.adminLanguage,
          passwordCredential: { create: { passwordHash } },
          teamMemberships: { create: { teamId: createdTeam.id, role: 'admin' } },
        },
      });
      await recordAuditLog(tx, {
        teamId: createdTeam.id,
        actorId: currentUser.id,
        actionType: 'team_created',
        targetEntity: 'team',
        targetId: createdTeam.id,
        afterState: { name: createdTeam.name, season: createdTeam.season },
      });
      await recordSystemAuditLog(tx, {
        actorId: currentUser.id,
        teamId: createdTeam.id,
        actionType: 'team_created',
        targetEntity: 'team',
        targetId: createdTeam.id,
        afterState: { name: createdTeam.name, season: createdTeam.season },
      });
      return { team: createdTeam, admin: createdAdmin };
    });

    reply.status(201);
    return systemCreateTeamResponseSchema.parse({
      team: {
        id: team.id,
        name: team.name,
        season: team.season,
        timezone: team.timezone,
        primaryColor: team.primaryColor,
      },
      admin: {
        id: admin.id,
        name: admin.name,
        phone: admin.phone,
        email: admin.email,
        languagePreference: admin.languagePreference,
      },
    });
  });

  // System admin adds a parent or admin directly to an existing team, with a
  // password of their own choosing.
  app.post('/system/teams/:teamId/members', async (request, reply) => {
    const currentUser = await guard(app, request);
    const { teamId } = teamParams.parse(request.params);
    const body = systemAddMemberRequestSchema.parse(request.body);
    const team = await app.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new HttpError(404, 'Team not found.');

    const result = await app.prisma.$transaction(async (tx) => {
      const { user, reactivating } = await createOrReactivateTeamMember(tx, {
        teamId,
        role: body.role,
        name: body.name,
        phone: body.phone,
        email: body.email,
        language: body.language,
        password: body.password,
        players: body.role === 'parent' ? body.players : [],
      });
      await recordAuditLog(tx, {
        teamId,
        actorId: currentUser.id,
        actionType: 'member_added_directly',
        targetEntity: 'team_member',
        targetId: user.id,
        afterState: {
          userId: user.id,
          name: user.name,
          role: body.role,
          reactivated: reactivating,
        },
      });
      await recordSystemAuditLog(tx, {
        actorId: currentUser.id,
        teamId,
        actionType: 'member_added_directly',
        targetEntity: 'team_member',
        targetId: user.id,
        afterState: {
          userId: user.id,
          name: user.name,
          role: body.role,
          reactivated: reactivating,
        },
      });
      const outboxEvent = await recordOutboxEvent(tx, {
        teamId,
        eventType: 'member_added_directly',
        category: 'admin_changes',
        recipientScope: { type: 'team_broadcast' },
        payload: { userId: user.id, userName: user.name },
      });
      return { user, outboxEventId: outboxEvent.id };
    });

    enqueueOutboxEventBestEffort(app.outboxQueue, result.outboxEventId);
    reply.status(201);
    return {
      id: result.user.id,
      name: result.user.name,
      phone: result.user.phone,
      email: result.user.email,
      isActive: true,
      systemRole: null,
      hasPassword: true,
      role: body.role,
      joinedAt: result.user.createdAt.toISOString(),
    };
  });

  // System admin resets any user's password, across any team.
  app.post('/system/users/:id/set-password', async (request, reply) => {
    const currentUser = await guard(app, request);
    const { id } = idParams.parse(request.params);
    const body = setPasswordRequestSchema.parse(request.body);

    const target = await app.prisma.user.findUnique({ where: { id } });
    if (!target) throw new HttpError(404, 'User not found.');

    const password = assertAcceptablePassword(body.password, [
      target.email ?? '',
      target.phone ?? '',
    ]);
    const passwordHash = await hashPassword(password);

    await app.prisma.$transaction(async (tx) => {
      await tx.passwordCredential.upsert({
        where: { userId: id },
        create: { userId: id, passwordHash },
        update: { passwordHash, passwordChangedAt: new Date() },
      });
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await recordSystemAuditLog(tx, {
        actorId: currentUser.id,
        actionType: 'password_set_by_admin',
        targetEntity: 'user',
        targetId: id,
      });
    });

    reply.status(204).send();
  });
}
