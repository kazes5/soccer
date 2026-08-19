import { z } from 'zod';

export const teamRoleSchema = z.enum(['parent', 'admin']);
export type TeamRole = z.infer<typeof teamRoleSchema>;

export const systemRoleSchema = z.enum(['system_admin']);
export type SystemRole = z.infer<typeof systemRoleSchema>;

export const languageSchema = z.enum(['en', 'he']);
export type Language = z.infer<typeof languageSchema>;

// Matches @soccer/ui-tokens's BrandColorKey — a curated palette, not
// free-text/arbitrary hex (see brand.ts's doc comment for why).
export const teamAccentColorSchema = z.enum([
  'green',
  'blue',
  'indigo',
  'purple',
  'fuchsia',
  'slate',
  'red',
  'orange',
  'yellow',
]);
export type TeamAccentColor = z.infer<typeof teamAccentColorSchema>;

export const collectionPointTypeSchema = z.enum(['pickup', 'dropoff', 'both']);
export type CollectionPointType = z.infer<typeof collectionPointTypeSchema>;

export const shiftDirectionSchema = z.enum(['to_practice', 'from_practice']);
export type ShiftDirection = z.infer<typeof shiftDirectionSchema>;

export const sessionStatusSchema = z.enum(['scheduled', 'completed', 'cancelled']);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const shiftStatusSchema = z.enum(['open', 'claimed', 'pending_swap']);
export type ShiftStatus = z.infer<typeof shiftStatusSchema>;

export const swapRequestStatusSchema = z.enum([
  'pending',
  'accepted',
  'declined',
  'expired',
  'cancelled',
]);
export type SwapRequestStatus = z.infer<typeof swapRequestStatusSchema>;

export const notificationCategorySchema = z.enum([
  'shift_changes',
  'swaps',
  'reminders',
  'escalations',
  'admin_changes',
]);
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

export const notificationChannelSchema = z.enum(['push', 'sms', 'email']);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;
