import type { AuditLogAiContext } from '@soccer/contracts';
import type { AuditSource, Prisma, PrismaClient } from '../../generated/prisma/client';

export interface RecordAuditLogInput {
  teamId: string;
  actorId?: string | null;
  actionType: string;
  targetEntity: string;
  targetId?: string | null;
  beforeState?: Prisma.InputJsonValue;
  afterState?: Prisma.InputJsonValue;
  source?: AuditSource;
  /** Required when `source: 'ai_chat'` — see CLAUDE.md §6.3. Left undefined
   *  (not just omitted) for every `source: 'app'` call site today. */
  aiContext?: AuditLogAiContext | null;
}

export function recordAuditLog(
  db: PrismaClient | Prisma.TransactionClient,
  input: RecordAuditLogInput,
) {
  return db.auditLog.create({
    data: {
      teamId: input.teamId,
      actorId: input.actorId ?? null,
      actionType: input.actionType,
      targetEntity: input.targetEntity,
      targetId: input.targetId ?? null,
      beforeState: input.beforeState,
      afterState: input.afterState,
      source: input.source ?? 'app',
      aiContext: input.aiContext ?? undefined,
    },
  });
}
