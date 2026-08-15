import {
  auditLogFilterSchema,
  auditLogListQuerySchema,
  auditLogListResponseSchema,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import { requireAuth, requirePrivilegedAssurance, requireTeamRole } from '../lib/authorization';

const teamParamsSchema = z.object({ teamId: z.string().uuid() });

type AuditLogWithActor = Prisma.AuditLogGetPayload<{
  include: { actor: { select: { id: true; name: true } } };
}>;

function auditLogWhere(
  teamId: string,
  filters: z.infer<typeof auditLogFilterSchema>,
): Prisma.AuditLogWhereInput {
  const search = filters.search;

  return {
    teamId,
    ...(filters.actor
      ? { actor: { is: { name: { contains: filters.actor, mode: 'insensitive' } } } }
      : {}),
    ...(filters.action ? { actionType: { equals: filters.action, mode: 'insensitive' } } : {}),
    ...(filters.target ? { targetEntity: { equals: filters.target, mode: 'insensitive' } } : {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: new Date(filters.from) } : {}),
            ...(filters.to ? { lte: new Date(filters.to) } : {}),
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { actionType: { contains: search, mode: 'insensitive' } },
            { targetEntity: { contains: search, mode: 'insensitive' } },
            { targetId: { contains: search, mode: 'insensitive' } },
            { actor: { is: { name: { contains: search, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };
}

function serializeAuditLog(row: AuditLogWithActor) {
  return {
    id: row.id,
    teamId: row.teamId,
    actor: row.actor ? { id: row.actor.id, name: row.actor.name } : null,
    actionType: row.actionType,
    targetEntity: row.targetEntity,
    targetId: row.targetId,
    beforeState: row.beforeState,
    afterState: row.afterState,
    source: row.source,
    aiContext: row.aiContext,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Prevent spreadsheet formula execution while preserving the visible value. */
function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
  const safe = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function auditLogCsv(rows: AuditLogWithActor[]): string {
  const header = [
    'created_at',
    'actor',
    'action',
    'target_entity',
    'target_id',
    'source',
    'before_state',
    'after_state',
    'ai_context',
  ];
  const lines = rows.map((row) =>
    [
      row.createdAt.toISOString(),
      row.actor?.name ?? '',
      row.actionType,
      row.targetEntity,
      row.targetId,
      row.source,
      row.beforeState,
      row.afterState,
      row.aiContext,
    ]
      .map(csvCell)
      .join(','),
  );
  return `\uFEFF${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
}

export default async function auditLogRoutes(app: FastifyInstance) {
  app.get('/teams/:teamId/audit-logs', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const query = auditLogListQuerySchema.parse(request.query);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);
    requirePrivilegedAssurance(currentUser);

    const rows = await app.prisma.auditLog.findMany({
      where: auditLogWhere(params.teamId, query),
      include: { actor: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return auditLogListResponseSchema.parse({
      entries: page.map(serializeAuditLog),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    });
  });

  app.get('/teams/:teamId/audit-logs/export', async (request, reply) => {
    const params = teamParamsSchema.parse(request.params);
    const query = auditLogFilterSchema.parse(request.query);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);
    requirePrivilegedAssurance(currentUser);

    const rows = await app.prisma.auditLog.findMany({
      where: auditLogWhere(params.teamId, query),
      include: { actor: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10_000,
    });

    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="audit-logs-${params.teamId}.csv"`)
      .send(auditLogCsv(rows));
  });
}
