import { z } from 'zod';
import { timeOfDaySchema } from './common';
import { REMINDER_OFFSET_MINUTES_MAX_COUNT } from './coordination-settings';
import { notificationCategorySchema, notificationChannelSchema } from './enums';

export const categoryPreferenceSchema = z.object({
  category: notificationCategorySchema,
  channel: notificationChannelSchema.default('push'),
  enabled: z.boolean(),
});
export type CategoryPreference = z.infer<typeof categoryPreferenceSchema>;

/**
 * All fields are independently optional so a caller can update just one
 * concern at a time. `null` on a quiet-hours field explicitly clears a
 * personal override (falls back to the team default); an empty
 * `reminderOffsetMinutes` array clears the personal offset override the same
 * way. Omitting a field entirely leaves its current value untouched.
 */
export const updateMemberNotificationPreferencesRequestSchema = z.object({
  teamId: z.string().uuid(),
  quietHoursStart: timeOfDaySchema.nullable().optional(),
  quietHoursEnd: timeOfDaySchema.nullable().optional(),
  reminderOffsetMinutes: z
    .array(z.number().int().positive())
    .max(REMINDER_OFFSET_MINUTES_MAX_COUNT)
    .optional(),
  categoryPreferences: z.array(categoryPreferenceSchema).optional(),
});
export type UpdateMemberNotificationPreferencesRequest = z.infer<
  typeof updateMemberNotificationPreferencesRequestSchema
>;

export const memberNotificationPreferencesSchema = z.object({
  teamId: z.string().uuid(),
  quietHoursStart: timeOfDaySchema.nullable(),
  quietHoursEnd: timeOfDaySchema.nullable(),
  reminderOffsetMinutes: z.array(z.number().int()),
  categoryPreferences: z.array(categoryPreferenceSchema),
});
export type MemberNotificationPreferences = z.infer<typeof memberNotificationPreferencesSchema>;
