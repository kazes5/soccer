import type {
  NotificationCategory,
  NotificationSeverity,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client';

export type RecipientScopeInput =
  | { type: 'team_broadcast' }
  | { type: 'participants'; userIds: string[] }
  | { type: 'self'; userId: string };

export interface RecordOutboxEventInput {
  teamId: string;
  eventType: string;
  category: NotificationCategory;
  severity?: NotificationSeverity;
  payload: Prisma.InputJsonValue;
  recipientScope: RecipientScopeInput;
}

/**
 * Writes one `OutboxEvent` row — call this inside the same transaction as
 * the domain mutation and its `recordAuditLog` call (see ADR 0001). Nothing
 * calls this yet; Checkpoint 4 retrofits existing mutating routes to do so.
 */
export function recordOutboxEvent(
  db: PrismaClient | Prisma.TransactionClient,
  input: RecordOutboxEventInput,
) {
  return db.outboxEvent.create({
    data: {
      teamId: input.teamId,
      eventType: input.eventType,
      category: input.category,
      severity: input.severity ?? 'normal',
      payload: input.payload,
      recipientScope: input.recipientScope.type,
      participantUserIds:
        input.recipientScope.type === 'participants' ? input.recipientScope.userIds : [],
      selfUserId: input.recipientScope.type === 'self' ? input.recipientScope.userId : null,
    },
  });
}
