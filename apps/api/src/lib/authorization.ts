import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient, TeamRole } from '../../generated/prisma/client';
import type { CurrentUser } from '../plugins/auth';
import { HttpError } from './errors';

export function requireAuth(request: FastifyRequest): CurrentUser {
  if (!request.currentUser) {
    throw new HttpError(401, 'Authentication required.');
  }
  return request.currentUser;
}

export async function requireSystemAdmin(
  prisma: PrismaClient,
  currentUser: CurrentUser,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: { isActive: true, systemRole: true },
  });
  if (!user?.isActive || user.systemRole !== 'system_admin') {
    throw new HttpError(403, 'System administrator access is required.');
  }
}

export async function requireTeamRole(
  prisma: PrismaClient,
  userId: string,
  teamId: string,
  allowedRoles: readonly TeamRole[],
) {
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });

  if (!membership || !allowedRoles.includes(membership.role)) {
    throw new HttpError(403, 'You do not have permission to perform this action.');
  }

  return membership;
}

/** A team admin manages their own team; a system admin manages any team —
 *  both are "administrative" here. Mirrors system.ts's own guard() in
 *  requiring `systemAdminEnabled` before the system-admin fallback, so the
 *  console's kill-switch also disables this for a system admin with no
 *  team membership of their own. Shared by players.ts and teams.ts. */
export async function requireTeamOrSystemAdmin(
  app: FastifyInstance,
  request: FastifyRequest,
  teamId: string,
): Promise<CurrentUser> {
  const currentUser = requireAuth(request);
  const membership = await app.prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: currentUser.id } },
  });
  if (membership?.role === 'admin') return currentUser;
  if (!app.systemAdminEnabled) throw new HttpError(403, 'Admin access is required for this team.');
  await requireSystemAdmin(app.prisma, currentUser);
  return currentUser;
}
