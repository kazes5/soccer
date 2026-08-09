import {
  createScheduleTemplateRequestSchema,
  createScheduleTemplateResponseSchema,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAuditLog } from '../lib/audit';
import { requireAuth, requireTeamRole } from '../lib/authorization';
import { HttpError } from '../lib/errors';
import { combineDateAndTime, generateOccurrences } from '../lib/recurrence';
import type { Prisma } from '../../generated/prisma/client';

const teamParamsSchema = z.object({ teamId: z.string().uuid() });

/** A `both` collection point needs a shift in each direction; pickup/dropoff need just one. */
function directionsFor(
  type: 'pickup' | 'dropoff' | 'both',
): Array<'to_practice' | 'from_practice'> {
  if (type === 'both') return ['to_practice', 'from_practice'];
  return type === 'pickup' ? ['to_practice'] : ['from_practice'];
}

export default async function scheduleTemplateRoutes(app: FastifyInstance) {
  app.get('/teams/:teamId/schedule-templates', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const templates = await app.prisma.scheduleTemplate.findMany({
      where: { teamId: params.teamId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      templates: templates.map((template) => ({
        id: template.id,
        teamId: template.teamId,
        recurrenceRule: template.recurrenceRule,
        startDate: template.startDate.toISOString().slice(0, 10),
        defaultTime: template.defaultTime,
        defaultFieldLocation: template.defaultFieldLocation,
        horizonWeeks: template.horizonWeeks,
        createdByUserId: template.createdByUserId,
        createdAt: template.createdAt.toISOString(),
      })),
    };
  });

  app.post('/teams/:teamId/schedule-templates', async (request, reply) => {
    const params = teamParamsSchema.parse(request.params);
    const body = createScheduleTemplateRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);

    const uniquePointIds = [...new Set(body.collectionPointIds)];
    const points = await app.prisma.collectionPoint.findMany({
      where: { id: { in: uniquePointIds }, teamId: params.teamId },
    });
    if (points.length !== uniquePointIds.length) {
      throw new HttpError(400, 'One or more collection points were not found on this team.');
    }

    const startDate = new Date(`${body.startDate}T00:00:00.000Z`);
    const dtstart = combineDateAndTime(startDate, body.defaultTime);
    let occurrences: Date[];
    try {
      occurrences = generateOccurrences(body.recurrenceRule, dtstart, body.horizonWeeks);
    } catch {
      throw new HttpError(400, 'Invalid recurrence rule.');
    }

    const result = await app.prisma.$transaction(async (tx) => {
      const template = await tx.scheduleTemplate.create({
        data: {
          teamId: params.teamId,
          recurrenceRule: body.recurrenceRule,
          startDate,
          defaultTime: body.defaultTime,
          defaultFieldLocation: body.defaultFieldLocation,
          horizonWeeks: body.horizonWeeks,
          createdByUserId: currentUser.id,
        },
      });

      await tx.scheduleTemplateCollectionPoint.createMany({
        data: points.map((point) => ({ templateId: template.id, pointId: point.id })),
      });

      let sessionsCreated = 0;
      for (const startsAt of occurrences) {
        await createSessionWithShifts(tx, {
          teamId: params.teamId,
          templateId: template.id,
          startsAt,
          fieldLocation: body.defaultFieldLocation,
          points,
        });
        sessionsCreated += 1;
      }

      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'schedule_template_created',
        targetEntity: 'schedule_template',
        targetId: template.id,
        afterState: { recurrenceRule: template.recurrenceRule, sessionsCreated },
      });

      return { template, sessionsCreated };
    });

    reply.status(201);
    return createScheduleTemplateResponseSchema.parse({
      template: {
        id: result.template.id,
        teamId: result.template.teamId,
        recurrenceRule: result.template.recurrenceRule,
        startDate: result.template.startDate.toISOString().slice(0, 10),
        defaultTime: result.template.defaultTime,
        defaultFieldLocation: result.template.defaultFieldLocation,
        horizonWeeks: result.template.horizonWeeks,
        createdByUserId: result.template.createdByUserId,
        createdAt: result.template.createdAt.toISOString(),
      },
      sessionsCreated: result.sessionsCreated,
    });
  });
}

/**
 * Creates one practice session plus its session-point assignments and shifts —
 * exactly one shift per valid (session, point, direction) tuple, per PLAN.md's
 * architecture decision. Shared by template-driven generation and (in a later
 * checkpoint) any ad-hoc/admin-created session.
 */
export async function createSessionWithShifts(
  tx: Prisma.TransactionClient,
  input: {
    teamId: string;
    templateId: string | null;
    startsAt: Date;
    fieldLocation: string;
    points: Array<{ id: string; type: 'pickup' | 'dropoff' | 'both' }>;
  },
) {
  const session = await tx.practiceSession.create({
    data: {
      teamId: input.teamId,
      templateId: input.templateId,
      startsAt: input.startsAt,
      fieldLocation: input.fieldLocation,
    },
  });

  for (const point of input.points) {
    for (const direction of directionsFor(point.type)) {
      await tx.sessionPointAssignment.create({
        data: { sessionId: session.id, pointId: point.id, direction, playerIds: [] },
      });
      await tx.shift.create({
        data: { sessionId: session.id, pointId: point.id, direction },
      });
    }
  }

  return session;
}
