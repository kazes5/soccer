import {
  coordinationSettingsRequestSchema,
  coordinationSettingsSchema,
  ESCALATION_LEAD_MINUTES_DEFAULT,
  REMINDER_OFFSET_MINUTES_DEFAULT,
  SWAP_EXPIRY_HOURS_DEFAULT,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAuditLog } from '../lib/audit';
import { requireAuth, requireTeamRole } from '../lib/authorization';
import { enqueueScheduledTaskBestEffort } from '../lib/queues';
import { findShiftIdsUsingTeamDefaultOffsets, syncRemindersForShifts } from '../lib/reminders';

const teamParamsSchema = z.object({ teamId: z.string().uuid() });

function toDto(
  teamId: string,
  settings: {
    swapExpiryHours: number;
    reminderOffsetMinutes: number[];
    escalationLeadMinutes: number;
  } | null,
) {
  return {
    teamId,
    swapExpiryHours: settings?.swapExpiryHours ?? SWAP_EXPIRY_HOURS_DEFAULT,
    reminderOffsetMinutes: settings?.reminderOffsetMinutes ?? REMINDER_OFFSET_MINUTES_DEFAULT,
    escalationLeadMinutes: settings?.escalationLeadMinutes ?? ESCALATION_LEAD_MINUTES_DEFAULT,
  };
}

export default async function coordinationSettingsRoutes(app: FastifyInstance) {
  // A missing row means "using defaults" — no row is created until the first
  // PATCH, so every existing team (created before this endpoint existed)
  // reads the same documented defaults without a data migration.
  app.get('/teams/:teamId/coordination-settings', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const settings = await app.prisma.coordinationSettings.findUnique({
      where: { teamId: params.teamId },
    });

    return coordinationSettingsSchema.parse(toDto(params.teamId, settings));
  });

  app.patch('/teams/:teamId/coordination-settings', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const body = coordinationSettingsRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);

    const settings = await app.prisma.$transaction(async (tx) => {
      // Read immediately before the write, inside this transaction — not
      // from a snapshot taken before it opened — so a concurrent PATCH can't
      // make the audit log's beforeState stale relative to what was actually
      // in the database just before this write (same hazard as the session
      // PATCH partial-update fix; here it's the audit trail, not the write
      // itself, since the upsert always applies the full submitted object).
      const existing = await tx.coordinationSettings.findUnique({
        where: { teamId: params.teamId },
      });

      const updated = await tx.coordinationSettings.upsert({
        where: { teamId: params.teamId },
        create: {
          teamId: params.teamId,
          swapExpiryHours: body.swapExpiryHours,
          reminderOffsetMinutes: body.reminderOffsetMinutes,
          escalationLeadMinutes: body.escalationLeadMinutes,
        },
        update: {
          swapExpiryHours: body.swapExpiryHours,
          reminderOffsetMinutes: body.reminderOffsetMinutes,
          escalationLeadMinutes: body.escalationLeadMinutes,
        },
      });

      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'coordination_settings_updated',
        targetEntity: 'coordination_settings',
        targetId: params.teamId,
        beforeState: toDto(params.teamId, existing),
        afterState: toDto(params.teamId, updated),
      });

      // Only re-derive reminders when the team default actually changed —
      // it only affects members with no personal override, but re-deriving
      // is otherwise indistinguishable from a no-op for everyone else, so
      // skip the (bounded but real, at up to ~100 members) query work when
      // nothing that matters to it moved.
      const previousOffsets = toDto(params.teamId, existing).reminderOffsetMinutes;
      const reminders =
        previousOffsets.length !== body.reminderOffsetMinutes.length ||
        previousOffsets.some((value, index) => value !== body.reminderOffsetMinutes[index])
          ? await syncRemindersForShifts(
              tx,
              await findShiftIdsUsingTeamDefaultOffsets(tx, params.teamId),
            )
          : [];

      return { updated, reminders };
    });

    enqueueScheduledTaskBestEffort(app.scheduledTaskQueue, settings.reminders);

    return coordinationSettingsSchema.parse(toDto(params.teamId, settings.updated));
  });
}
