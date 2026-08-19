import {
  collectionPointListResponseSchema,
  collectionPointRequestSchema,
  collectionPointSchema,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAuditLog } from '../lib/audit';
import { requireAuth, requireTeamRole } from '../lib/authorization';
import { HttpError } from '../lib/errors';

const teamParamsSchema = z.object({ teamId: z.string().uuid() });
const pointParamsSchema = z.object({ teamId: z.string().uuid(), pointId: z.string().uuid() });

function toDto(point: {
  id: string;
  teamId: string;
  name: string;
  address: string;
  gpsLat: { toNumber: () => number } | null;
  gpsLng: { toNumber: () => number } | null;
  type: 'pickup' | 'dropoff' | 'both';
}) {
  return {
    id: point.id,
    teamId: point.teamId,
    name: point.name,
    address: point.address,
    gpsLat: point.gpsLat?.toNumber() ?? null,
    gpsLng: point.gpsLng?.toNumber() ?? null,
    type: point.type,
  };
}

export default async function collectionPointRoutes(app: FastifyInstance) {
  app.get('/teams/:teamId/collection-points', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const points = await app.prisma.collectionPoint.findMany({
      where: { teamId: params.teamId },
      orderBy: { name: 'asc' },
    });

    return collectionPointListResponseSchema.parse({ points: points.map(toDto) });
  });

  app.post('/teams/:teamId/collection-points', async (request, reply) => {
    const params = teamParamsSchema.parse(request.params);
    const body = collectionPointRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);

    const point = await app.prisma.$transaction(async (tx) => {
      const created = await tx.collectionPoint.create({
        data: {
          teamId: params.teamId,
          name: body.name,
          address: body.address,
          // This endpoint fully replaces the record (no partial-patch
          // semantics), so an omitted coordinate means "no GPS", not "leave
          // whatever was there" — Prisma would otherwise treat `undefined` as
          // a no-op and a previously-set coordinate could never be cleared.
          gpsLat: body.gpsLat ?? null,
          gpsLng: body.gpsLng ?? null,
          type: body.type,
        },
      });

      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'collection_point_created',
        targetEntity: 'collection_point',
        targetId: created.id,
        afterState: { name: created.name, address: created.address, type: created.type },
      });

      return created;
    });

    reply.status(201);
    return collectionPointSchema.parse(toDto(point));
  });

  app.patch('/teams/:teamId/collection-points/:pointId', async (request) => {
    const params = pointParamsSchema.parse(request.params);
    const body = collectionPointRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);

    const existing = await app.prisma.collectionPoint.findUnique({ where: { id: params.pointId } });
    if (!existing || existing.teamId !== params.teamId) {
      throw new HttpError(404, 'Collection point not found.');
    }

    const point = await app.prisma.$transaction(async (tx) => {
      const updated = await tx.collectionPoint.update({
        where: { id: params.pointId },
        data: {
          name: body.name,
          address: body.address,
          // This endpoint fully replaces the record (no partial-patch
          // semantics), so an omitted coordinate means "no GPS", not "leave
          // whatever was there" — Prisma would otherwise treat `undefined` as
          // a no-op and a previously-set coordinate could never be cleared.
          gpsLat: body.gpsLat ?? null,
          gpsLng: body.gpsLng ?? null,
          type: body.type,
        },
      });

      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'collection_point_updated',
        targetEntity: 'collection_point',
        targetId: updated.id,
        beforeState: { name: existing.name, address: existing.address, type: existing.type },
        afterState: { name: updated.name, address: updated.address, type: updated.type },
      });

      return updated;
    });

    return collectionPointSchema.parse(toDto(point));
  });

  app.delete('/teams/:teamId/collection-points/:pointId', async (request, reply) => {
    const params = pointParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);

    const existing = await app.prisma.collectionPoint.findUnique({ where: { id: params.pointId } });
    if (!existing || existing.teamId !== params.teamId) {
      throw new HttpError(404, 'Collection point not found.');
    }

    const shiftCount = await app.prisma.shift.count({ where: { pointId: params.pointId } });
    if (shiftCount > 0) {
      throw new HttpError(
        409,
        'This collection point has scheduled sessions and cannot be deleted.',
      );
    }

    await app.prisma.$transaction(async (tx) => {
      await tx.collectionPoint.delete({ where: { id: params.pointId } });

      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'collection_point_deleted',
        targetEntity: 'collection_point',
        targetId: params.pointId,
        beforeState: { name: existing.name, address: existing.address, type: existing.type },
      });
    });

    reply.status(204).send();
  });
}
