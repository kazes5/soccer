import type { SwapRequest } from '@soccer/contracts';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { recordAuditLog } from './audit';
import { HttpError } from './errors';
import { recordOutboxEvent } from './outbox';

export const swapRequestInclude = {
  shift: { include: { point: true, session: true } },
  requestingUser: true,
  currentHolder: true,
} as const;

export type SwapRequestWithRelations = Prisma.SwapRequestGetPayload<{
  include: typeof swapRequestInclude;
}>;

export function loadSwapRequestWithRelations(
  db: PrismaClient | Prisma.TransactionClient,
  id: string,
) {
  return db.swapRequest.findUnique({ where: { id }, include: swapRequestInclude });
}

export function toSwapRequestDto(row: SwapRequestWithRelations): SwapRequest {
  return {
    id: row.id,
    teamId: row.teamId,
    shiftId: row.shiftId,
    sessionId: row.shift.sessionId,
    sessionStartsAt: row.shift.session.startsAt.toISOString(),
    pointId: row.shift.pointId,
    pointName: row.shift.point.name,
    direction: row.shift.direction,
    requestingUserId: row.requestingUserId,
    requestingUserName: row.requestingUser.name,
    currentHolderId: row.currentHolderId,
    currentHolderName: row.currentHolder.name,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A pending swap request's own `swap_expiry` `ScheduledTask` is found by its
 *  payload rather than a stored foreign key — cheap at this app's scale and
 *  avoids a schema field only ever read here. Marking it cancelled (rather
 *  than deleting) lets `processScheduledTask` still no-op safely if the
 *  delayed BullMQ job manages to fire anyway before this write lands. */
export async function cancelPendingExpiryTask(
  tx: Prisma.TransactionClient,
  swapRequestId: string,
): Promise<void> {
  await tx.scheduledTask.updateMany({
    where: {
      type: 'swap_expiry',
      payload: { path: ['swapRequestId'], equals: swapRequestId },
      completedAt: null,
      cancelledAt: null,
    },
    data: { cancelledAt: new Date() },
  });
}

/**
 * The three non-accept terminal outcomes (decline, cancel, expire) share the
 * exact same shape: revert the shift from `pending_swap` back to `claimed`
 * under the *same* holder (only accept reassigns it), transition the
 * `SwapRequest` row, cancel its own pending expiry task (a no-op if this
 * transition *is* the expiry), and record the audit/outbox pair. Called from
 * both the `swap-requests` routes (decline/cancel) and the scheduled-task
 * processor (expire) — the one piece of swap logic genuinely shared between
 * an HTTP route and a worker processor, unlike every other command in this
 * codebase, which only ever runs from a route.
 */
export async function resolveSwapRequestOutcome(
  tx: Prisma.TransactionClient,
  existing: SwapRequestWithRelations,
  outcome: 'declined' | 'cancelled' | 'expired',
  actorId: string | null,
): Promise<string> {
  const reverted = await tx.shift.updateMany({
    where: {
      id: existing.shiftId,
      status: 'pending_swap',
      assignedUserId: existing.currentHolderId,
      version: existing.shift.version,
    },
    data: { status: 'claimed', version: { increment: 1 } },
  });
  if (reverted.count === 0) {
    throw new HttpError(409, 'This shift changed and could not be reverted.');
  }

  const requestUpdated = await tx.swapRequest.updateMany({
    where: { id: existing.id, status: 'pending' },
    data: { status: outcome },
  });
  if (requestUpdated.count === 0) {
    throw new HttpError(409, 'This swap request is no longer pending.');
  }

  await cancelPendingExpiryTask(tx, existing.id);

  const eventType =
    outcome === 'declined'
      ? 'swap_declined'
      : outcome === 'cancelled'
        ? 'swap_cancelled'
        : 'swap_expired';

  await recordAuditLog(tx, {
    teamId: existing.teamId,
    actorId,
    actionType: eventType,
    targetEntity: 'swap_request',
    targetId: existing.id,
    beforeState: { status: 'pending' },
    afterState: { status: outcome },
  });

  const outboxEvent = await recordOutboxEvent(tx, {
    teamId: existing.teamId,
    eventType,
    category: 'swaps',
    recipientScope: { type: 'team_broadcast' },
    actorId: actorId ?? undefined,
    payload: {
      swapRequestId: existing.id,
      shiftId: existing.shiftId,
      sessionId: existing.shift.sessionId,
      pointId: existing.shift.pointId,
      pointName: existing.shift.point.name,
      direction: existing.shift.direction,
      requestingUserId: existing.requestingUserId,
      requestingUserName: existing.requestingUser.name,
      currentHolderId: existing.currentHolderId,
      currentHolderName: existing.currentHolder.name,
    },
  });

  return outboxEvent.id;
}
