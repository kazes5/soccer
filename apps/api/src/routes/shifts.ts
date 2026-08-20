import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { claimShift, getMyStats, releaseShift } from '../lib/chat-actions';
import { requireAuth } from '../lib/authorization';

const teamParamsSchema = z.object({ teamId: z.string().uuid() });
const shiftParamsSchema = z.object({ teamId: z.string().uuid(), shiftId: z.string().uuid() });

export default async function shiftRoutes(app: FastifyInstance) {
  // Any team member (not admin-only) — CLAUDE.md's Requirement 13 keeps
  // individual member stats admin-only but lets every parent see the team
  // average for self-comparison, computed here so the caller never needs the
  // roster itself.
  app.get('/teams/:teamId/shifts/stats', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    return getMyStats(app, currentUser, params.teamId);
  });

  app.post('/teams/:teamId/shifts/:shiftId/claim', async (request) => {
    const params = shiftParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    return claimShift(app, currentUser, params.teamId, params.shiftId, { source: 'app' });
  });

  app.post('/teams/:teamId/shifts/:shiftId/release', async (request) => {
    const params = shiftParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    return releaseShift(app, currentUser, params.teamId, params.shiftId, { source: 'app' });
  });
}
