import {
  coachMessageImportSettingsSchema,
  scheduleImportApplyRequestSchema,
  scheduleImportApplyResponseSchema,
  scheduleImportOperationSchema,
  scheduleImportPreviewRequestSchema,
  scheduleImportPreviewResponseSchema,
  type ScheduleImportOperation,
} from '@soccer/contracts';
import { translate } from '@soccer/i18n';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { env } from '../env';
import { recordAuditLog } from '../lib/audit';
import { requireAuth, requireTeamOrSystemAdmin, requireTeamRole } from '../lib/authorization';
import { assertChatRateLimit } from '../lib/chat-rate-limit';
import { createConfirmationToken, verifyConfirmationToken } from '../lib/chat-confirmation';
import { HttpError } from '../lib/errors';
import { completeJson } from '../lib/openrouter';
import { recordOutboxEvent } from '../lib/outbox';
import { enqueueOutboxEventBestEffort, enqueueScheduledTaskBestEffort } from '../lib/queues';
import { syncRemindersForShifts } from '../lib/reminders';
import { buildExtractionPrompt, parseExtraction, planOperations } from '../lib/schedule-import';
import { instantToWallClock, isPastCalendarDay, localDateTimeToInstant } from '../lib/timezone';
import { createSessionWithShifts } from './schedule-templates';

const teamParamsSchema = z.object({ teamId: z.string().uuid() });

/** The signed proposal's `toolName` — keeps an import token from ever
 *  verifying as a chat-tool confirmation, or vice versa. */
const PROPOSAL_TOOL_NAME = 'schedule_import';
/** Long enough to read the proposal over with the coach's message open
 *  alongside it; short enough that a stale preview can't be applied days later. */
const PROPOSAL_TTL_MS = 30 * 60 * 1000;
/** A week of practices plus a game or two, each with notes, fits comfortably. */
const EXTRACTION_MAX_TOKENS = 2000;

function proposalArgsJson(message: string, operations: ScheduleImportOperation[]): string {
  return JSON.stringify({ message, operations });
}

async function requireImportEnabled(app: FastifyInstance, teamId: string) {
  const team = await app.prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    select: { timezone: true, coachMessageImportEnabled: true },
  });
  if (!team.coachMessageImportEnabled) {
    throw new HttpError(403, 'Importing coach messages is turned off for this team.');
  }
  return team;
}

export default async function scheduleImportRoutes(app: FastifyInstance) {
  // Readable by every team member (the schedule page decides whether to show
  // the import button) and by a system admin managing the team.
  app.get('/teams/:teamId/coach-message-import', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    const membership = await app.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: params.teamId, userId: currentUser.id } },
    });
    if (!membership) await requireTeamOrSystemAdmin(app, request, params.teamId);

    const team = await app.prisma.team.findUnique({
      where: { id: params.teamId },
      select: { coachMessageImportEnabled: true },
    });
    if (!team) throw new HttpError(404, 'Team not found.');
    return coachMessageImportSettingsSchema.parse({ enabled: team.coachMessageImportEnabled });
  });

  app.patch('/teams/:teamId/coach-message-import', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const body = coachMessageImportSettingsSchema.parse(request.body);
    const currentUser = await requireTeamOrSystemAdmin(app, request, params.teamId);

    const existing = await app.prisma.team.findUnique({ where: { id: params.teamId } });
    if (!existing) throw new HttpError(404, 'Team not found.');

    const updated = await app.prisma.$transaction(async (tx) => {
      const team = await tx.team.update({
        where: { id: params.teamId },
        data: { coachMessageImportEnabled: body.enabled },
      });
      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'coach_message_import_setting_updated',
        targetEntity: 'team',
        targetId: params.teamId,
        beforeState: { enabled: existing.coachMessageImportEnabled },
        afterState: { enabled: team.coachMessageImportEnabled },
      });
      return team;
    });

    return coachMessageImportSettingsSchema.parse({ enabled: updated.coachMessageImportEnabled });
  });

  /**
   * Reads the message with the model and returns a proposal — writes nothing
   * to the schedule. Open to every team member (not just admins) by design:
   * the coach's message is the authority, a parent is only relaying it, and
   * every change still goes through review, the audit log (`source:
   * ai_chat`) and a team-wide broadcast.
   */
  app.post('/teams/:teamId/schedule-import/preview', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const body = scheduleImportPreviewRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);
    const team = await requireImportEnabled(app, params.teamId);

    const apiKey = app.openRouterApiKey;
    const secret = app.chatConfirmationSecret;
    if (!apiKey || !secret) {
      throw new HttpError(503, 'Assistant temporarily unavailable.');
    }
    // Same spend bound as chat — this is one more paid model call.
    await assertChatRateLimit(app, currentUser.id, request.ip);

    const now = new Date();
    const referenceDate = body.referenceDate ?? instantToWallClock(now, team.timezone).date;

    let raw: unknown;
    try {
      raw = await completeJson({
        apiKey,
        model: env.OPENROUTER_MODEL,
        maxTokens: EXTRACTION_MAX_TOKENS,
        messages: [
          { role: 'system', content: buildExtractionPrompt(referenceDate) },
          { role: 'user', content: body.message },
        ],
      });
    } catch (err) {
      request.log.error(err);
      throw new HttpError(503, 'Assistant temporarily unavailable.');
    }
    const extraction = parseExtraction(raw);

    // Everything an extracted date could match: from today through the
    // furthest date the model mentioned (bounded inside planOperations) —
    // plus the rest of that week, which replacing a week cancels even on
    // days the message doesn't name.
    const mentionedDates = [
      ...extraction.events.map((event) => event.date),
      ...extraction.cancellations.map((cancellation) => cancellation.date),
      ...(extraction.periodEnd ? [extraction.periodEnd] : []),
    ].sort();
    const lastDate = mentionedDates.at(-1);
    const sessions = lastDate
      ? await app.prisma.practiceSession.findMany({
          where: {
            teamId: params.teamId,
            status: 'scheduled',
            startsAt: {
              gte: DateTime.fromJSDate(now).minus({ days: 1 }).toJSDate(),
              lte: DateTime.fromISO(lastDate, { zone: team.timezone }).plus({ days: 7 }).toJSDate(),
            },
          },
          orderBy: { startsAt: 'asc' },
        })
      : [];

    const plan = planOperations({
      extraction,
      sessions,
      timeZone: team.timezone,
      now,
      locationPlaceholder: translate(body.locale, 'scheduleImport.locationTbd'),
      replaceWeek: body.replaceWeek,
    });
    // Matches the apply request's own cap — a proposal that couldn't be
    // applied anyway is refused here rather than handed to the member.
    if (plan.operations.length > 50) {
      throw new HttpError(422, 'This message describes too many changes to apply at once.');
    }
    // Signed in its parsed (canonical key order) form — the same form apply
    // re-derives from its own parsed request body before verifying.
    const operations = z.array(scheduleImportOperationSchema).parse(plan.operations);

    const proposalToken = createConfirmationToken(
      {
        userId: currentUser.id,
        teamId: params.teamId,
        toolName: PROPOSAL_TOOL_NAME,
        argsJson: proposalArgsJson(body.message, operations),
      },
      secret,
      PROPOSAL_TTL_MS,
    );

    return scheduleImportPreviewResponseSchema.parse({
      operations,
      unresolved: plan.unresolved,
      replacedWeek: plan.replacedWeek,
      proposalToken,
    });
  });

  /**
   * Applies the subset of a preview's operations the member kept checked, all
   * or nothing, in one transaction. The proposal token proves `operations` is
   * exactly what preview produced for this user and message; each update or
   * cancel also re-checks that its session hasn't changed since (its
   * `updatedAt`), so a preview built on a stale schedule fails cleanly
   * instead of overwriting someone else's edit.
   */
  app.post('/teams/:teamId/schedule-import/apply', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const body = scheduleImportApplyRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);
    const team = await requireImportEnabled(app, params.teamId);

    const secret = app.chatConfirmationSecret;
    if (!secret) throw new HttpError(503, 'Assistant temporarily unavailable.');
    const valid = verifyConfirmationToken(
      body.proposalToken,
      {
        userId: currentUser.id,
        teamId: params.teamId,
        toolName: PROPOSAL_TOOL_NAME,
        argsJson: proposalArgsJson(body.message, body.operations),
      },
      secret,
    );
    if (!valid) {
      throw new HttpError(409, 'This proposal has expired. Please review the message again.');
    }

    const selectedIndexes = [...new Set(body.selected)].sort((a, b) => a - b);
    if (selectedIndexes.some((index) => index >= body.operations.length)) {
      throw new HttpError(400, 'Selected changes do not match the proposal.');
    }
    // Cancellations first: replacing a week cancels a session and creates its
    // successor at the same time, which the duplicate guard on creates below
    // would otherwise refuse.
    const selected = selectedIndexes
      .map((index) => body.operations[index]!)
      .sort((a, b) => Number(a.type !== 'cancel') - Number(b.type !== 'cancel'));
    const staleMessage =
      'The schedule changed since this preview. Please review the message again.';

    // New sessions get the same collection points the team's schedule
    // normally uses: the most recent template's, or every point the team has.
    const latestTemplate = await app.prisma.scheduleTemplate.findFirst({
      where: { teamId: params.teamId },
      orderBy: { createdAt: 'desc' },
      include: { collectionPoints: { include: { point: true } } },
    });
    const defaultPoints =
      latestTemplate && latestTemplate.collectionPoints.length > 0
        ? latestTemplate.collectionPoints.map((assignment) => assignment.point)
        : await app.prisma.collectionPoint.findMany({ where: { teamId: params.teamId } });

    const result = await app.prisma.$transaction(async (tx) => {
      const counts = { created: 0, updated: 0, cancelled: 0 };
      const touchedShiftIds: string[] = [];

      for (const operation of selected) {
        const aiContext = {
          transcript: body.message,
          translatedAction: JSON.stringify(operation).slice(0, 500),
          result: 'success' as const,
        };

        if (operation.type === 'create') {
          const fields = operation.after;
          const startsAt = localDateTimeToInstant(fields.date, fields.time, team.timezone);
          if (isPastCalendarDay(startsAt, team.timezone)) throw new HttpError(409, staleMessage);
          // Creates are what make a proposal replayable — updates and cancels
          // are already single-use through their `updatedAt` guard. Refusing a
          // create when a session already starts at that exact time stops the
          // same signed proposal (valid for 30 minutes) from being applied again
          // to stack duplicate sessions and broadcasts.
          const duplicate = await tx.practiceSession.findFirst({
            where: { teamId: params.teamId, startsAt, status: 'scheduled' },
            select: { id: true },
          });
          if (duplicate) {
            throw new HttpError(
              409,
              'A session already exists at that time. Keep its cancellation selected, or untick the new one.',
            );
          }
          const session = await createSessionWithShifts(tx, {
            teamId: params.teamId,
            templateId: null,
            startsAt,
            fieldLocation: fields.fieldLocation,
            kind: fields.kind,
            title: fields.title,
            notes: fields.notes,
            points: defaultPoints,
          });
          await recordAuditLog(tx, {
            teamId: params.teamId,
            actorId: currentUser.id,
            actionType: 'session_created',
            targetEntity: 'practice_session',
            targetId: session.id,
            afterState: { ...fields, startsAt: startsAt.toISOString() },
            source: 'ai_chat',
            aiContext,
          });
          counts.created += 1;
          continue;
        }

        const existing = await tx.practiceSession.findUnique({
          where: { id: operation.sessionId },
          include: { shifts: { select: { id: true } } },
        });
        if (
          !existing ||
          existing.teamId !== params.teamId ||
          existing.status !== 'scheduled' ||
          existing.updatedAt.toISOString() !== operation.expectedUpdatedAt ||
          isPastCalendarDay(existing.startsAt, team.timezone)
        ) {
          throw new HttpError(409, staleMessage);
        }
        touchedShiftIds.push(...existing.shifts.map((shift) => shift.id));

        if (operation.type === 'update') {
          const fields = operation.after;
          const startsAt = localDateTimeToInstant(fields.date, fields.time, team.timezone);
          if (isPastCalendarDay(startsAt, team.timezone)) throw new HttpError(409, staleMessage);
          await tx.practiceSession.update({
            where: { id: existing.id },
            data: {
              startsAt,
              fieldLocation: fields.fieldLocation,
              kind: fields.kind,
              title: fields.title,
              notes: fields.notes,
            },
          });
          await recordAuditLog(tx, {
            teamId: params.teamId,
            actorId: currentUser.id,
            actionType: 'session_updated',
            targetEntity: 'practice_session',
            targetId: existing.id,
            beforeState: { ...operation.before, startsAt: existing.startsAt.toISOString() },
            afterState: { ...fields, startsAt: startsAt.toISOString() },
            source: 'ai_chat',
            aiContext,
          });
          counts.updated += 1;
        } else {
          await tx.practiceSession.update({
            where: { id: existing.id },
            data: { status: 'cancelled' },
          });
          await recordAuditLog(tx, {
            teamId: params.teamId,
            actorId: currentUser.id,
            actionType: 'session_cancelled',
            targetEntity: 'practice_session',
            targetId: existing.id,
            beforeState: { status: existing.status },
            afterState: { status: 'cancelled', reason: operation.reason },
            source: 'ai_chat',
            aiContext,
          });
          counts.cancelled += 1;
        }
      }

      // One broadcast for the whole import, not one per session — a week's
      // schedule is often five or six changes, and the team throttle (CLAUDE.md
      // §9.4) would otherwise spend most of its hourly budget on one paste.
      const outboxEvent = await recordOutboxEvent(tx, {
        teamId: params.teamId,
        eventType: 'schedule_imported',
        category: 'shift_changes',
        recipientScope: { type: 'team_broadcast' },
        payload: { byUserName: currentUser.name, ...counts },
      });

      // Moved sessions move their reminders; cancelled ones drop them.
      const reminders = await syncRemindersForShifts(tx, touchedShiftIds);
      return { counts, outboxEventId: outboxEvent.id, reminders };
    });

    enqueueOutboxEventBestEffort(app.outboxQueue, result.outboxEventId);
    enqueueScheduledTaskBestEffort(app.scheduledTaskQueue, result.reminders);

    return scheduleImportApplyResponseSchema.parse(result.counts);
  });
}
