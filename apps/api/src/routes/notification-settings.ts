import {
  QUIET_HOURS_END_DEFAULT,
  QUIET_HOURS_START_DEFAULT,
  teamNotificationSettingsRequestSchema,
  teamNotificationSettingsSchema,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAuditLog } from '../lib/audit';
import { requireAuth, requireTeamRole } from '../lib/authorization';

const teamParamsSchema = z.object({ teamId: z.string().uuid() });

function toDto(
  teamId: string,
  settings: { quietHoursStart: string; quietHoursEnd: string } | null,
) {
  return {
    teamId,
    quietHoursStart: settings?.quietHoursStart ?? QUIET_HOURS_START_DEFAULT,
    quietHoursEnd: settings?.quietHoursEnd ?? QUIET_HOURS_END_DEFAULT,
  };
}

export default async function notificationSettingsRoutes(app: FastifyInstance) {
  // A missing row means "using the documented default quiet-hours window" —
  // no row is created until the first PATCH, same pattern as coordination
  // settings (see that route for the full rationale).
  app.get('/teams/:teamId/notification-settings', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['parent', 'admin']);

    const settings = await app.prisma.teamNotificationSettings.findUnique({
      where: { teamId: params.teamId },
    });

    return teamNotificationSettingsSchema.parse(toDto(params.teamId, settings));
  });

  app.patch('/teams/:teamId/notification-settings', async (request) => {
    const params = teamParamsSchema.parse(request.params);
    const body = teamNotificationSettingsRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, params.teamId, ['admin']);

    const settings = await app.prisma.$transaction(async (tx) => {
      // Read immediately before the write, inside this transaction — see
      // coordination-settings.ts's identical comment for the full rationale
      // (audit-log beforeState accuracy under a concurrent PATCH).
      const existing = await tx.teamNotificationSettings.findUnique({
        where: { teamId: params.teamId },
      });

      const updated = await tx.teamNotificationSettings.upsert({
        where: { teamId: params.teamId },
        create: {
          teamId: params.teamId,
          quietHoursStart: body.quietHoursStart,
          quietHoursEnd: body.quietHoursEnd,
        },
        update: {
          quietHoursStart: body.quietHoursStart,
          quietHoursEnd: body.quietHoursEnd,
        },
      });

      await recordAuditLog(tx, {
        teamId: params.teamId,
        actorId: currentUser.id,
        actionType: 'notification_settings_updated',
        targetEntity: 'team_notification_settings',
        targetId: params.teamId,
        beforeState: toDto(params.teamId, existing),
        afterState: toDto(params.teamId, updated),
      });

      return updated;
    });

    return teamNotificationSettingsSchema.parse(toDto(params.teamId, settings));
  });
}
