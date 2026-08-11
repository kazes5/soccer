import { z } from 'zod';

export const SWAP_EXPIRY_HOURS_DEFAULT = 24;
export const SWAP_EXPIRY_HOURS_MIN = 1;
export const SWAP_EXPIRY_HOURS_MAX = 168;

export const REMINDER_OFFSET_MINUTES_DEFAULT = [1440, 120];
export const REMINDER_OFFSET_MINUTES_MAX_COUNT = 4;

export const ESCALATION_LEAD_MINUTES_DEFAULT = 120;

/** The admin unresolved-coverage alert always fires a fixed 60 minutes before
 * the session — escalation must lead that by a positive margin, or the two
 * alerts would fire in the wrong order (or simultaneously). */
export const ADMIN_ALERT_LEAD_MINUTES = 60;

export const coordinationSettingsRequestSchema = z.object({
  swapExpiryHours: z.number().int().min(SWAP_EXPIRY_HOURS_MIN).max(SWAP_EXPIRY_HOURS_MAX),
  reminderOffsetMinutes: z
    .array(z.number().int().positive())
    .min(1)
    .max(REMINDER_OFFSET_MINUTES_MAX_COUNT),
  escalationLeadMinutes: z
    .number()
    .int()
    .refine((value) => value > ADMIN_ALERT_LEAD_MINUTES, {
      message: `Escalation lead time must be greater than the fixed ${ADMIN_ALERT_LEAD_MINUTES}-minute admin alert.`,
    }),
});
export type CoordinationSettingsRequest = z.infer<typeof coordinationSettingsRequestSchema>;

export const coordinationSettingsSchema = z.object({
  teamId: z.string().uuid(),
  swapExpiryHours: z.number().int(),
  reminderOffsetMinutes: z.array(z.number().int()),
  escalationLeadMinutes: z.number().int(),
});
export type CoordinationSettings = z.infer<typeof coordinationSettingsSchema>;
