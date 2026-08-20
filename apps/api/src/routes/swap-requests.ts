import { swapRequestListResponseSchema } from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  acceptSwapRequest,
  cancelSwapRequest,
  createSwapRequest,
  declineSwapRequest,
} from '../lib/chat-actions';
import { requireAuth, requireTeamRole } from '../lib/authorization';
import { swapRequestInclude, toSwapRequestDto } from '../lib/swap-requests';

const teamParamsSchema = z.object({ teamId: z.string().uuid() });
const shiftParamsSchema = z.object({ teamId: z.string().uuid(), shiftId: z.string().uuid() });
const swapRequestParamsSchema = z.object({
  teamId: z.string().uuid(),
  swapRequestId: z.string().uuid(),
});

export default async function swapRequestRoutes(app: FastifyInstance) {
  // Every team member can see every swap request, not just their own — the
  // same "transparent schedule" philosophy CLAUDE.md applies to shifts
  // (§3.6) extends to who's asked to take over whose shift. The web client
  // derives "needs your response" / "your requests" / read-only "team
  // activity" groupings from `requestingUserId`/`currentHolderId` client-
  // side, the same way Schedule derives `canClaim`/`canRelease` from shift
  // fields rather than the server pre-computing per-viewer booleans.
  app.get('/teams/:teamId/swap-requests', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const swapRequests = await app.prisma.swapRequest.findMany({
      where: { teamId: params.teamId },
      include: swapRequestInclude,
      orderBy: { createdAt: 'desc' },
    });

    return swapRequestListResponseSchema.parse({
      swapRequests: swapRequests.map(toSwapRequestDto),
    });
  });

  app.post('/teams/:teamId/shifts/:shiftId/swap-requests', async (request) => {
    const params = shiftParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    return createSwapRequest(app, currentUser, params.teamId, params.shiftId, { source: 'app' });
  });

  app.post('/teams/:teamId/swap-requests/:swapRequestId/accept', async (request) => {
    const params = swapRequestParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    return acceptSwapRequest(app, currentUser, params.teamId, params.swapRequestId, {
      source: 'app',
    });
  });

  app.post('/teams/:teamId/swap-requests/:swapRequestId/decline', async (request) => {
    const params = swapRequestParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    return declineSwapRequest(app, currentUser, params.teamId, params.swapRequestId, {
      source: 'app',
    });
  });

  app.post('/teams/:teamId/swap-requests/:swapRequestId/cancel', async (request) => {
    const params = swapRequestParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    return cancelSwapRequest(app, currentUser, params.teamId, params.swapRequestId, {
      source: 'app',
    });
  });
}
