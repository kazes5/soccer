import type { FastifyRequest } from 'fastify';
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
