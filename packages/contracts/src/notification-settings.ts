import { z } from 'zod';
import { timeOfDaySchema } from './common';

export const QUIET_HOURS_START_DEFAULT = '22:00';
export const QUIET_HOURS_END_DEFAULT = '07:00';

/** Team-wide default quiet-hours window — the fallback for any member who
 * hasn't set a personal override (see `member-notification-preferences.ts`). */
export const teamNotificationSettingsRequestSchema = z.object({
  quietHoursStart: timeOfDaySchema,
  quietHoursEnd: timeOfDaySchema,
});
export type TeamNotificationSettingsRequest = z.infer<typeof teamNotificationSettingsRequestSchema>;

export const teamNotificationSettingsSchema = z.object({
  teamId: z.string().uuid(),
  quietHoursStart: timeOfDaySchema,
  quietHoursEnd: timeOfDaySchema,
});
export type TeamNotificationSettings = z.infer<typeof teamNotificationSettingsSchema>;
