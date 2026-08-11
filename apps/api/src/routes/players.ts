import { playerListResponseSchema } from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireTeamRole } from '../lib/authorization';

const teamParamsSchema = z.object({ teamId: z.string().uuid() });

export default async function playerRoutes(app: FastifyInstance) {
  app.get('/teams/:teamId/players', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const players = await app.prisma.player.findMany({
      where: { teamId: params.teamId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, age: true },
    });

    return playerListResponseSchema.parse({
      players: players.map((player) => ({ id: player.id, name: player.name, age: player.age })),
    });
  });
}
