import {
  memberNotificationPreferencesSchema,
  notificationCategorySchema,
  updateMemberNotificationPreferencesRequestSchema,
} from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { NotificationCategory, Prisma, PrismaClient } from '../../generated/prisma/client';
import { recordAuditLog } from '../lib/audit';
import { requireAuth, requireTeamRole } from '../lib/authorization';

const teamQuerySchema = z.object({ teamId: z.string().uuid() });

const ALL_CATEGORIES = notificationCategorySchema.options;

async function buildCategoryPreferences(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  teamId: string,
): Promise<{ category: NotificationCategory; channel: 'push'; enabled: boolean }[]> {
  const rows = await db.notificationPreference.findMany({
    where: { userId, teamId, channel: 'push' },
  });
  const byCategory = new Map(rows.map((row) => [row.category, row.enabled]));

  // Every category defaults to enabled (opt-out model) until a row exists —
  // no row is created until the caller explicitly toggles that category off.
  return ALL_CATEGORIES.map((category) => ({
    category,
    channel: 'push' as const,
    enabled: byCategory.get(category) ?? true,
  }));
}

async function toDto(db: PrismaClient | Prisma.TransactionClient, userId: string, teamId: string) {
  const settings = await db.memberNotificationSettings.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });

  return memberNotificationPreferencesSchema.parse({
    teamId,
    quietHoursStart: settings?.quietHoursStart ?? null,
    quietHoursEnd: settings?.quietHoursEnd ?? null,
    reminderOffsetMinutes: settings?.reminderOffsetMinutes ?? [],
    categoryPreferences: await buildCategoryPreferences(db, userId, teamId),
  });
}

export default async function memberPreferencesRoutes(app: FastifyInstance) {
  app.get('/users/me/preferences', async (request) => {
    const query = teamQuerySchema.parse(request.query);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, query.teamId, ['parent', 'admin']);

    return toDto(app.prisma, currentUser.id, query.teamId);
  });

  app.patch('/users/me/preferences', async (request) => {
    const body = updateMemberNotificationPreferencesRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);
    await requireTeamRole(app.prisma, currentUser.id, body.teamId, ['parent', 'admin']);

    const before = await toDto(app.prisma, currentUser.id, body.teamId);

    const after = await app.prisma.$transaction(async (tx) => {
      if (
        body.quietHoursStart !== undefined ||
        body.quietHoursEnd !== undefined ||
        body.reminderOffsetMinutes !== undefined
      ) {
        // Re-read immediately before the write (inside this transaction, not
        // from `before` above) so whichever of the three fields wasn't sent
        // keeps its freshest value rather than one from a stale snapshot —
        // same lost-update hazard fixed for the session-time PATCH endpoint.
        const fresh = await tx.memberNotificationSettings.findUnique({
          where: { userId_teamId: { userId: currentUser.id, teamId: body.teamId } },
        });

        const quietHoursStart =
          body.quietHoursStart !== undefined
            ? body.quietHoursStart
            : (fresh?.quietHoursStart ?? null);
        const quietHoursEnd =
          body.quietHoursEnd !== undefined ? body.quietHoursEnd : (fresh?.quietHoursEnd ?? null);
        const reminderOffsetMinutes =
          body.reminderOffsetMinutes ?? fresh?.reminderOffsetMinutes ?? [];

        await tx.memberNotificationSettings.upsert({
          where: { userId_teamId: { userId: currentUser.id, teamId: body.teamId } },
          create: {
            userId: currentUser.id,
            teamId: body.teamId,
            quietHoursStart,
            quietHoursEnd,
            reminderOffsetMinutes,
          },
          update: { quietHoursStart, quietHoursEnd, reminderOffsetMinutes },
        });
      }

      if (body.categoryPreferences) {
        for (const pref of body.categoryPreferences) {
          await tx.notificationPreference.upsert({
            where: {
              userId_teamId_category_channel: {
                userId: currentUser.id,
                teamId: body.teamId,
                category: pref.category,
                channel: pref.channel,
              },
            },
            create: {
              userId: currentUser.id,
              teamId: body.teamId,
              category: pref.category,
              channel: pref.channel,
              enabled: pref.enabled,
            },
            update: { enabled: pref.enabled },
          });
        }
      }

      const afterDto = await toDto(tx, currentUser.id, body.teamId);

      await recordAuditLog(tx, {
        teamId: body.teamId,
        actorId: currentUser.id,
        actionType: 'member_notification_preferences_updated',
        targetEntity: 'member_notification_settings',
        targetId: currentUser.id,
        beforeState: before,
        afterState: afterDto,
      });

      return afterDto;
    });

    return after;
  });
}
