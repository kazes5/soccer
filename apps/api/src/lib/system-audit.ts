import type { AuditSource, Prisma, PrismaClient } from '../../generated/prisma/client';

export function recordSystemAuditLog(
  db: PrismaClient | Prisma.TransactionClient,
  input: {
    actorId?: string | null;
    actionType: string;
    targetEntity: string;
    targetId?: string | null;
    teamId?: string | null;
    beforeState?: Prisma.InputJsonValue;
    afterState?: Prisma.InputJsonValue;
    source?: AuditSource;
  },
) {
  return db.systemAuditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actionType: input.actionType,
      targetEntity: input.targetEntity,
      targetId: input.targetId ?? null,
      teamId: input.teamId ?? null,
      beforeState: input.beforeState,
      afterState: input.afterState,
      source: input.source ?? 'app',
    },
  });
}
