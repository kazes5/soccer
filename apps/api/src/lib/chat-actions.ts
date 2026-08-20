import {
  SWAP_EXPIRY_HOURS_DEFAULT,
  sessionListResponseSchema,
  shiftStatsResponseSchema,
  shiftSummarySchema,
  swapRequestSchema,
  type SessionListResponse,
  type ShiftStatsResponse,
  type ShiftSummary,
  type SwapRequest,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { recordAuditLog } from './audit';
import { requireTeamRole } from './authorization';
import { HttpError } from './errors';
import { recordOutboxEvent } from './outbox';
import {
  enqueueOutboxEventBestEffort,
  enqueueScheduledTask,
  enqueueScheduledTaskBestEffort,
} from './queues';
import { syncShiftReminders } from './reminders';
import { recordScheduledTask } from './scheduled-tasks';
import {
  cancelPendingExpiryTask,
  loadSwapRequestWithRelations,
  resolveSwapRequestOutcome,
  toSwapRequestDto,
} from './swap-requests';
import { isPastCalendarDay } from './timezone';
import type { CurrentUser } from '../plugins/auth';

/**
 * The reusable action layer CLAUDE.md §6.2 calls for: every function here is
 * the *same* logic the HTTP routes in routes/shifts.ts and
 * routes/swap-requests.ts call (those routes now just parse params, resolve
 * `currentUser`, and call through with `{ source: 'app' }`) — so an AI-chat
 * tool call and a manual UI click hit identical validation, optimistic-lock
 * CAS, audit logging, and notification fan-out. Nothing here is chat-
 * specific except the `ChatAuditSource` parameter.
 *
 * `currentUser`/`teamId` are always plain function parameters sourced by the
 * *caller* from a real authenticated request — never accepted as data a
 * chat tool's own JSON arguments could supply, which is what keeps identity
 * spoofing off the table for an AI-invoked action.
 */
export type ChatAuditSource = { source: 'app' } | { source: 'ai_chat'; transcript: string };

function aiContextFor(
  audit: ChatAuditSource,
  translatedAction: string,
): { transcript: string; translatedAction: string; result: 'success' } | null {
  return audit.source === 'ai_chat'
    ? { transcript: audit.transcript, translatedAction, result: 'success' }
    : null;
}

export async function claimShift(
  app: FastifyInstance,
  currentUser: CurrentUser,
  teamId: string,
  shiftId: string,
  audit: ChatAuditSource,
): Promise<ShiftSummary> {
  await requireTeamRole(app.prisma, currentUser.id, teamId, ['parent', 'admin']);

  const shift = await app.prisma.shift.findUnique({
    where: { id: shiftId },
    include: { session: { include: { team: { select: { timezone: true } } } } },
  });
  if (!shift || shift.session.teamId !== teamId) {
    throw new HttpError(404, 'Shift not found.');
  }
  if (shift.session.status !== 'scheduled') {
    throw new HttpError(409, 'This session is no longer scheduled.');
  }
  if (isPastCalendarDay(shift.session.startsAt, shift.session.team.timezone)) {
    throw new HttpError(409, 'This session has already happened and can no longer be claimed.');
  }

  const updated = await app.prisma.$transaction(async (tx) => {
    const claimed = await tx.shift.updateMany({
      where: { id: shiftId, status: 'open', version: shift.version },
      data: { status: 'claimed', assignedUserId: currentUser.id, version: { increment: 1 } },
    });
    if (claimed.count === 0) {
      const current = await tx.shift.findUniqueOrThrow({
        where: { id: shiftId },
        include: { assignedUser: true },
      });
      throw new HttpError(409, 'That shift was just claimed by someone else.', {
        holderName: current.assignedUser?.name ?? null,
      });
    }

    const result = await tx.shift.findUniqueOrThrow({
      where: { id: shiftId },
      include: { assignedUser: true, point: true },
    });

    await recordAuditLog(tx, {
      teamId,
      actorId: currentUser.id,
      actionType: 'shift_claimed',
      targetEntity: 'shift',
      targetId: result.id,
      beforeState: { status: 'open', version: shift.version },
      afterState: {
        status: result.status,
        assignedUserId: result.assignedUserId,
        version: result.version,
      },
      source: audit.source,
      aiContext: aiContextFor(audit, `claim_shift(shiftId=${shiftId})`),
    });

    const outboxEvent = await recordOutboxEvent(tx, {
      teamId,
      eventType: 'shift_claimed',
      category: 'shift_changes',
      recipientScope: { type: 'team_broadcast' },
      payload: {
        sessionId: result.sessionId,
        shiftId: result.id,
        pointId: result.pointId,
        pointName: result.point.name,
        direction: result.direction,
        sessionStartsAt: shift.session.startsAt.toISOString(),
        byUserName: currentUser.name,
      },
    });

    const reminders = await syncShiftReminders(tx, result.id);
    return { result, outboxEventId: outboxEvent.id, reminders };
  });

  enqueueOutboxEventBestEffort(app.outboxQueue, updated.outboxEventId);
  enqueueScheduledTaskBestEffort(app.scheduledTaskQueue, updated.reminders);

  return shiftSummarySchema.parse(toShiftDto(updated.result));
}

export async function releaseShift(
  app: FastifyInstance,
  currentUser: CurrentUser,
  teamId: string,
  shiftId: string,
  audit: ChatAuditSource,
): Promise<ShiftSummary> {
  await requireTeamRole(app.prisma, currentUser.id, teamId, ['parent', 'admin']);

  const shift = await app.prisma.shift.findUnique({
    where: { id: shiftId },
    include: { session: { include: { team: { select: { timezone: true } } } } },
  });
  if (!shift || shift.session.teamId !== teamId) {
    throw new HttpError(404, 'Shift not found.');
  }
  if (shift.session.status !== 'scheduled') {
    throw new HttpError(409, 'This session is no longer scheduled.');
  }
  if (isPastCalendarDay(shift.session.startsAt, shift.session.team.timezone)) {
    throw new HttpError(409, 'This session has already happened and can no longer be released.');
  }

  const updated = await app.prisma.$transaction(async (tx) => {
    const released = await tx.shift.updateMany({
      where: {
        id: shiftId,
        status: 'claimed',
        assignedUserId: currentUser.id,
        version: shift.version,
      },
      data: { status: 'open', assignedUserId: null, version: { increment: 1 } },
    });
    if (released.count === 0) {
      throw new HttpError(409, 'This shift is no longer assigned to you.');
    }

    const result = await tx.shift.findUniqueOrThrow({
      where: { id: shiftId },
      include: { assignedUser: true, point: true },
    });

    await recordAuditLog(tx, {
      teamId,
      actorId: currentUser.id,
      actionType: 'shift_released',
      targetEntity: 'shift',
      targetId: result.id,
      beforeState: { status: 'claimed', assignedUserId: currentUser.id, version: shift.version },
      afterState: { status: result.status, version: result.version },
      source: audit.source,
      aiContext: aiContextFor(audit, `release_shift(shiftId=${shiftId})`),
    });

    const outboxEvent = await recordOutboxEvent(tx, {
      teamId,
      eventType: 'shift_released',
      category: 'shift_changes',
      recipientScope: { type: 'team_broadcast' },
      payload: {
        sessionId: result.sessionId,
        shiftId: result.id,
        pointId: result.pointId,
        pointName: result.point.name,
        direction: result.direction,
        sessionStartsAt: shift.session.startsAt.toISOString(),
        byUserName: currentUser.name,
        reason: 'voluntary',
      },
    });

    const reminders = await syncShiftReminders(tx, result.id);
    return { result, outboxEventId: outboxEvent.id, reminders };
  });

  enqueueOutboxEventBestEffort(app.outboxQueue, updated.outboxEventId);
  enqueueScheduledTaskBestEffort(app.scheduledTaskQueue, updated.reminders);

  return shiftSummarySchema.parse(toShiftDto(updated.result));
}

function toShiftDto(shift: {
  id: string;
  sessionId: string;
  pointId: string;
  direction: 'to_practice' | 'from_practice';
  status: 'open' | 'claimed' | 'pending_swap';
  assignedUserId: string | null;
  assignedUser: { name: string } | null;
  version: number;
}) {
  return {
    id: shift.id,
    sessionId: shift.sessionId,
    pointId: shift.pointId,
    direction: shift.direction,
    status: shift.status,
    assignedUserId: shift.assignedUserId,
    assignedUserName: shift.assignedUser?.name ?? null,
    version: shift.version,
  };
}

export async function createSwapRequest(
  app: FastifyInstance,
  currentUser: CurrentUser,
  teamId: string,
  shiftId: string,
  audit: ChatAuditSource,
): Promise<SwapRequest> {
  await requireTeamRole(app.prisma, currentUser.id, teamId, ['parent', 'admin']);

  const shift = await app.prisma.shift.findUnique({
    where: { id: shiftId },
    include: { session: { include: { team: { select: { timezone: true } } } }, point: true },
  });
  if (!shift || shift.session.teamId !== teamId) {
    throw new HttpError(404, 'Shift not found.');
  }
  if (shift.session.status !== 'scheduled') {
    throw new HttpError(409, 'This session is no longer scheduled.');
  }
  if (isPastCalendarDay(shift.session.startsAt, shift.session.team.timezone)) {
    throw new HttpError(409, 'This session has already happened and can no longer be swapped.');
  }
  if (shift.status !== 'claimed' || !shift.assignedUserId) {
    throw new HttpError(409, 'This shift is not currently held by anyone to request.');
  }
  if (shift.assignedUserId === currentUser.id) {
    throw new HttpError(400, 'You already hold this shift.');
  }

  const settings = await app.prisma.coordinationSettings.findUnique({ where: { teamId } });
  const swapExpiryHours = settings?.swapExpiryHours ?? SWAP_EXPIRY_HOURS_DEFAULT;
  const expiresAt = new Date(
    Math.min(Date.now() + swapExpiryHours * 60 * 60 * 1000, shift.session.startsAt.getTime()),
  );
  const holderId = shift.assignedUserId;

  const created = await app.prisma.$transaction(async (tx) => {
    const flipped = await tx.shift.updateMany({
      where: { id: shiftId, status: 'claimed', version: shift.version },
      data: { status: 'pending_swap', version: { increment: 1 } },
    });
    if (flipped.count === 0) {
      throw new HttpError(409, 'This shift is no longer available to request.');
    }

    const swapRequest = await tx.swapRequest.create({
      data: {
        teamId,
        shiftId,
        requestingUserId: currentUser.id,
        currentHolderId: holderId,
        expiresAt,
      },
    });

    const scheduledTask = await recordScheduledTask(tx, {
      teamId,
      type: 'swap_expiry',
      payload: { swapRequestId: swapRequest.id },
      runAt: expiresAt,
    });

    await recordAuditLog(tx, {
      teamId,
      actorId: currentUser.id,
      actionType: 'swap_requested',
      targetEntity: 'swap_request',
      targetId: swapRequest.id,
      afterState: { status: 'pending', shiftId, currentHolderId: holderId },
      source: audit.source,
      aiContext: aiContextFor(audit, `create_swap_request(shiftId=${shiftId})`),
    });

    const outboxEvent = await recordOutboxEvent(tx, {
      teamId,
      eventType: 'swap_requested',
      category: 'swaps',
      recipientScope: { type: 'team_broadcast' },
      actorId: currentUser.id,
      payload: {
        swapRequestId: swapRequest.id,
        shiftId,
        sessionId: shift.sessionId,
        pointId: shift.pointId,
        pointName: shift.point.name,
        direction: shift.direction,
        requestingUserId: currentUser.id,
        requestingUserName: currentUser.name,
        currentHolderId: holderId,
      },
    });

    return {
      swapRequestId: swapRequest.id,
      outboxEventId: outboxEvent.id,
      scheduledTaskId: scheduledTask.id,
    };
  });

  enqueueOutboxEventBestEffort(app.outboxQueue, created.outboxEventId);
  void enqueueScheduledTask(app.scheduledTaskQueue, created.scheduledTaskId, expiresAt).catch(
    () => {},
  );

  const result = await loadSwapRequestWithRelations(app.prisma, created.swapRequestId);
  return swapRequestSchema.parse(toSwapRequestDto(result!));
}

export async function acceptSwapRequest(
  app: FastifyInstance,
  currentUser: CurrentUser,
  teamId: string,
  swapRequestId: string,
  audit: ChatAuditSource,
): Promise<SwapRequest> {
  await requireTeamRole(app.prisma, currentUser.id, teamId, ['parent', 'admin']);

  const existing = await loadSwapRequestWithRelations(app.prisma, swapRequestId);
  if (!existing || existing.teamId !== teamId) {
    throw new HttpError(404, 'Swap request not found.');
  }
  if (existing.currentHolderId !== currentUser.id) {
    throw new HttpError(403, 'Only the current shift holder can accept this swap request.');
  }
  if (existing.status !== 'pending' || existing.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(409, 'This swap request is no longer pending.');
  }

  const accepted = await app.prisma.$transaction(async (tx) => {
    const shiftUpdated = await tx.shift.updateMany({
      where: {
        id: existing.shiftId,
        status: 'pending_swap',
        assignedUserId: existing.currentHolderId,
        version: existing.shift.version,
      },
      data: {
        status: 'claimed',
        assignedUserId: existing.requestingUserId,
        version: { increment: 1 },
      },
    });
    if (shiftUpdated.count === 0) {
      throw new HttpError(409, 'This shift is no longer available to accept.');
    }

    const requestUpdated = await tx.swapRequest.updateMany({
      where: { id: existing.id, status: 'pending' },
      data: { status: 'accepted' },
    });
    if (requestUpdated.count === 0) {
      throw new HttpError(409, 'This swap request is no longer pending.');
    }

    await cancelPendingExpiryTask(tx, existing.id);

    await recordAuditLog(tx, {
      teamId,
      actorId: currentUser.id,
      actionType: 'swap_accepted',
      targetEntity: 'swap_request',
      targetId: existing.id,
      beforeState: { status: 'pending' },
      afterState: { status: 'accepted' },
      source: audit.source,
      aiContext: aiContextFor(audit, `accept_swap_request(swapRequestId=${swapRequestId})`),
    });

    const outboxEvent = await recordOutboxEvent(tx, {
      teamId,
      eventType: 'swap_accepted',
      category: 'swaps',
      recipientScope: { type: 'team_broadcast' },
      actorId: currentUser.id,
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

    const reminders = await syncShiftReminders(tx, existing.shiftId);
    return { outboxEventId: outboxEvent.id, reminders };
  });

  enqueueOutboxEventBestEffort(app.outboxQueue, accepted.outboxEventId);
  enqueueScheduledTaskBestEffort(app.scheduledTaskQueue, accepted.reminders);

  const updated = await loadSwapRequestWithRelations(app.prisma, swapRequestId);
  return swapRequestSchema.parse(toSwapRequestDto(updated!));
}

async function resolveSwapOutcomeAction(
  app: FastifyInstance,
  currentUser: CurrentUser,
  teamId: string,
  swapRequestId: string,
  outcome: 'declined' | 'cancelled',
  requiredParty: 'currentHolderId' | 'requestingUserId',
  forbiddenMessage: string,
  audit: ChatAuditSource,
  translatedAction: string,
): Promise<SwapRequest> {
  await requireTeamRole(app.prisma, currentUser.id, teamId, ['parent', 'admin']);

  const existing = await loadSwapRequestWithRelations(app.prisma, swapRequestId);
  if (!existing || existing.teamId !== teamId) {
    throw new HttpError(404, 'Swap request not found.');
  }
  if (existing[requiredParty] !== currentUser.id) {
    throw new HttpError(403, forbiddenMessage);
  }
  if (existing.status !== 'pending') {
    throw new HttpError(409, 'This swap request is no longer pending.');
  }

  const outboxEventId = await app.prisma.$transaction(async (tx) => {
    const id = await resolveSwapRequestOutcome(tx, existing, outcome, currentUser.id);
    if (audit.source === 'ai_chat') {
      // resolveSwapRequestOutcome already wrote the `source: 'app'` audit
      // row (it's shared with the worker's own expiry processor, which has
      // no chat concept) — chat needs its own row with `aiContext`, so this
      // adds a second, chat-specific entry rather than threading an audit
      // source parameter through a function three other call sites share.
      await recordAuditLog(tx, {
        teamId,
        actorId: currentUser.id,
        actionType: `swap_${outcome}_via_ai_chat`,
        targetEntity: 'swap_request',
        targetId: existing.id,
        afterState: { status: outcome },
        source: 'ai_chat',
        aiContext: { transcript: audit.transcript, translatedAction, result: 'success' },
      });
    }
    return id;
  });

  enqueueOutboxEventBestEffort(app.outboxQueue, outboxEventId);

  const updated = await loadSwapRequestWithRelations(app.prisma, swapRequestId);
  return swapRequestSchema.parse(toSwapRequestDto(updated!));
}

export function declineSwapRequest(
  app: FastifyInstance,
  currentUser: CurrentUser,
  teamId: string,
  swapRequestId: string,
  audit: ChatAuditSource,
): Promise<SwapRequest> {
  return resolveSwapOutcomeAction(
    app,
    currentUser,
    teamId,
    swapRequestId,
    'declined',
    'currentHolderId',
    'Only the current shift holder can decline this swap request.',
    audit,
    `decline_swap_request(swapRequestId=${swapRequestId})`,
  );
}

export function cancelSwapRequest(
  app: FastifyInstance,
  currentUser: CurrentUser,
  teamId: string,
  swapRequestId: string,
  audit: ChatAuditSource,
): Promise<SwapRequest> {
  return resolveSwapOutcomeAction(
    app,
    currentUser,
    teamId,
    swapRequestId,
    'cancelled',
    'requestingUserId',
    'Only the requester can cancel this swap request.',
    audit,
    `cancel_swap_request(swapRequestId=${swapRequestId})`,
  );
}

/** Backs the "what's my schedule", "who's picking up Wednesday", and "which
 *  shifts are open" chat questions with one general read — the model does
 *  the filtering reasoning over the returned list in its reply, the same way
 *  a parent visually scans the real Schedule page, rather than this needing
 *  three narrow single-purpose tools. */
export async function getSchedule(
  app: FastifyInstance,
  currentUser: CurrentUser,
  teamId: string,
  args: { from?: string; to?: string },
): Promise<SessionListResponse> {
  await requireTeamRole(app.prisma, currentUser.id, teamId, ['parent', 'admin']);

  const sessions = await app.prisma.practiceSession.findMany({
    where: {
      teamId,
      ...(args.from || args.to
        ? {
            startsAt: {
              ...(args.from ? { gte: new Date(args.from) } : {}),
              ...(args.to ? { lte: new Date(args.to) } : {}),
            },
          }
        : {}),
    },
    include: {
      assignments: { include: { point: true } },
      shifts: { include: { assignedUser: true } },
    },
    orderBy: { startsAt: 'asc' },
  });

  return sessionListResponseSchema.parse({
    sessions: sessions.map((session) => ({
      id: session.id,
      teamId: session.teamId,
      templateId: session.templateId,
      startsAt: session.startsAt.toISOString(),
      fieldLocation: session.fieldLocation,
      status: session.status,
      points: session.assignments.map((assignment) => {
        const shift = session.shifts.find(
          (candidate) =>
            candidate.pointId === assignment.pointId &&
            candidate.direction === assignment.direction,
        )!;
        return {
          pointId: assignment.pointId,
          pointName: assignment.point.name,
          direction: assignment.direction,
          playerIds: assignment.playerIds,
          shift: {
            id: shift.id,
            sessionId: shift.sessionId,
            pointId: shift.pointId,
            direction: shift.direction,
            status: shift.status,
            assignedUserId: shift.assignedUserId,
            assignedUserName: shift.assignedUser?.name ?? null,
            version: shift.version,
          },
        };
      }),
    })),
  });
}

export async function getMyStats(
  app: FastifyInstance,
  currentUser: CurrentUser,
  teamId: string,
): Promise<ShiftStatsResponse> {
  await requireTeamRole(app.prisma, currentUser.id, teamId, ['parent', 'admin']);

  const notCancelled = { session: { teamId, status: { not: 'cancelled' as const } } };
  const [myToPractice, myFromPractice, teamToPractice, teamFromPractice, teamMemberCount] =
    await Promise.all([
      app.prisma.shift.count({
        where: { ...notCancelled, assignedUserId: currentUser.id, direction: 'to_practice' },
      }),
      app.prisma.shift.count({
        where: { ...notCancelled, assignedUserId: currentUser.id, direction: 'from_practice' },
      }),
      app.prisma.shift.count({
        where: { ...notCancelled, assignedUserId: { not: null }, direction: 'to_practice' },
      }),
      app.prisma.shift.count({
        where: { ...notCancelled, assignedUserId: { not: null }, direction: 'from_practice' },
      }),
      app.prisma.teamMember.count({ where: { teamId } }),
    ]);

  const average = (count: number) => (teamMemberCount > 0 ? count / teamMemberCount : 0);

  return shiftStatsResponseSchema.parse({
    mine: {
      toPractice: myToPractice,
      fromPractice: myFromPractice,
      total: myToPractice + myFromPractice,
    },
    teamAverage: {
      toPractice: average(teamToPractice),
      fromPractice: average(teamFromPractice),
      total: average(teamToPractice + teamFromPractice),
    },
  });
}
