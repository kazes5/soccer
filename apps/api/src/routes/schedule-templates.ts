import {
  createScheduleTemplateRequestSchema,
  createScheduleTemplateResponseSchema,
  updateScheduleTemplateRequestSchema,
  updateScheduleTemplateResponseSchema,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAuditLog } from '../lib/audit';
import { requireAuth, requireTeamRole } from '../lib/authorization';
import { HttpError } from '../lib/errors';
import { combineDateAndTime, generateOccurrences } from '../lib/recurrence';
import type { Prisma } from '../../generated/prisma/client';

const teamParamsSchema = z.object({ teamId: z.string().uuid() });
const templateParamsSchema = z.object({
  teamId: z.string().uuid(),
  templateId: z.string().uuid(),
});

function toTemplateDto(template: {
  id: string;
  teamId: string;
  recurrenceRule: string;
  startDate: Date;
  defaultTime: string;
  defaultFieldLocation: string;
  horizonWeeks: number;
  createdByUserId: string;
  createdAt: Date;
}) {
  return {
    id: template.id,
    teamId: template.teamId,
    recurrenceRule: template.recurrenceRule,
    startDate: template.startDate.toISOString().slice(0, 10),
    defaultTime: template.defaultTime,
    defaultFieldLocation: template.defaultFieldLocation,
    horizonWeeks: template.horizonWeeks,
    createdByUserId: template.createdByUserId,
    createdAt: template.createdAt.toISOString(),
  };
}

/** A `both` collection point needs a shift in each direction; pickup/dropoff need just one. */
function directionsFor(
  type: 'pickup' | 'dropoff' | 'both',
): Array<'to_practice' | 'from_practice'> {
  if (type === 'both') return ['to_practice', 'from_practice'];
  return type === 'pickup' ? ['to_practice'] : ['from_practice'];
}

async function loadAndValidateCollectionPoints(
  prisma: FastifyInstance['prisma'],
  teamId: string,
  collectionPointIds: string[],
) {
  const uniquePointIds = [...new Set(collectionPointIds)];
  const points = await prisma.collectionPoint.findMany({
    where: { id: { in: uniquePointIds }, teamId },
  });
  if (points.length !== uniquePointIds.length) {
    throw new HttpError(400, 'One or more collection points were not found on this team.');
  }
  return points;
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

    return { templates: templates.map(toTemplateDto) };
  });

  app.post('/teams/:teamId/schedule-templates', async (request, reply) => {
    const params = teamParamsSchema.parse(request.params);
    const body = createScheduleTemplateRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);

    const points = await loadAndValidateCollectionPoints(
      app.prisma,
      params.teamId,
      body.collectionPointIds,
    );

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
      template: toTemplateDto(result.template),
      sessionsCreated: result.sessionsCreated,
    });
  });

  /**
   * Editing a template is purely additive: it recomputes the full occurrence set
   * (original `startDate` through the possibly-new horizon, under the possibly-new
   * rule) and creates a session for any future occurrence that doesn't already
   * have one. It never touches an existing session row — not its content, and not
   * its existence — even one that no longer matches the new pattern, per the
   * explicit decision recorded in PLAN.md's Stage 3 Progress note. One consequence
   * worth knowing: changing `defaultTime` doesn't move already-generated future
   * sessions to the new time — it creates new sessions at the new time alongside
   * whatever's already on the books at the old time, exactly as changing the
   * recurrence rule adds sessions for a newly-included weekday without touching
   * existing ones. `startDate` itself is not editable (see the contracts schema).
   */
  app.patch('/teams/:teamId/schedule-templates/:templateId', async (request) => {
    const params = templateParamsSchema.parse(request.params);
    const body = updateScheduleTemplateRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);

    const existing = await app.prisma.scheduleTemplate.findUnique({
      where: { id: params.templateId },
      include: { collectionPoints: { include: { point: true } } },
    });
    if (!existing || existing.teamId !== params.teamId) {
      throw new HttpError(404, 'Schedule template not found.');
    }

    const points = body.collectionPointIds
      ? await loadAndValidateCollectionPoints(app.prisma, params.teamId, body.collectionPointIds)
      : existing.collectionPoints.map((assignment) => assignment.point);

    const effective = {
      recurrenceRule: body.recurrenceRule ?? existing.recurrenceRule,
      defaultTime: body.defaultTime ?? existing.defaultTime,
      defaultFieldLocation: body.defaultFieldLocation ?? existing.defaultFieldLocation,
      horizonWeeks: body.horizonWeeks ?? existing.horizonWeeks,
    };

    const dtstart = combineDateAndTime(existing.startDate, effective.defaultTime);
    let occurrences: Date[];
    try {
      occurrences = generateOccurrences(effective.recurrenceRule, dtstart, effective.horizonWeeks);
    } catch {
      throw new HttpError(400, 'Invalid recurrence rule.');
    }

    const futureOccurrences = occurrences.filter((occurrence) => occurrence > new Date());
    const existingFutureSessions = futureOccurrences.length
      ? await app.prisma.practiceSession.findMany({
          where: { templateId: params.templateId, startsAt: { in: futureOccurrences } },
          select: { startsAt: true },
        })
      : [];
    const existingStartsAtMs = new Set(
      existingFutureSessions.map((session) => session.startsAt.getTime()),
    );
    const missingOccurrences = futureOccurrences.filter(
      (occurrence) => !existingStartsAtMs.has(occurrence.getTime()),
    );

    const result = await app.prisma.$transaction(async (tx) => {
      const updated = await tx.scheduleTemplate.update({
        where: { id: params.templateId },
        data: effective,
      });

      if (body.collectionPointIds) {
        await tx.scheduleTemplateCollectionPoint.deleteMany({
          where: { templateId: params.templateId },
        });
        await tx.scheduleTemplateCollectionPoint.createMany({
          data: points.map((point) => ({ templateId: params.templateId, pointId: point.id })),
        });
      }

      let sessionsCreated = 0;
      for (const startsAt of missingOccurrences) {
        await createSessionWithShifts(tx, {
          teamId: params.teamId,
          templateId: params.templateId,
          startsAt,
          fieldLocation: effective.defaultFieldLocation,
          points,
        });
        sessionsCreated += 1;
      }

      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'schedule_template_updated',
        targetEntity: 'schedule_template',
        targetId: updated.id,
        beforeState: {
          recurrenceRule: existing.recurrenceRule,
          defaultTime: existing.defaultTime,
          defaultFieldLocation: existing.defaultFieldLocation,
          horizonWeeks: existing.horizonWeeks,
          // Recorded even when unchanged, so a collection-point-only edit (the one
          // change this shape wouldn't otherwise show) still produces a real diff.
          collectionPointIds: existing.collectionPoints.map((assignment) => assignment.pointId),
        },
        afterState: {
          ...effective,
          collectionPointIds: points.map((point) => point.id),
          sessionsCreated,
        },
      });

      return { template: updated, sessionsCreated };
    });

    return updateScheduleTemplateResponseSchema.parse({
      template: toTemplateDto(result.template),
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
