import { z } from 'zod';
import { notificationCategorySchema } from './enums';

/**
 * The fixed set of mutations that fan out into a real notification, per the
 * Stage 4 Checkpoint 4 scoping decision: every audit-logged mutation
 * CLAUDE.md's Requirement 5 (or §4.2/§4.3) explicitly calls out as a
 * broadcast trigger. Settings changes, invite generation (as opposed to
 * acceptance), team bootstrap, and collection-point CRUD are deliberately
 * excluded — see the Stage 4 Checkpoint 4 Progress note in PLAN.md. The five
 * `swap_*` types (Checkpoint 7, CLAUDE.md §3.4/Requirement 4) were added
 * later, following the same "every lifecycle transition broadcasts" rule.
 */
export const notificationEventTypeSchema = z.enum([
  'shift_claimed',
  'shift_released',
  'session_updated',
  'session_cancelled',
  'session_point_players_updated',
  'schedule_template_created',
  'schedule_template_updated',
  'member_promoted',
  'member_demoted',
  'member_removed',
  'invite_accepted',
  'swap_requested',
  'swap_accepted',
  'swap_declined',
  'swap_expired',
  'swap_cancelled',
]);
export type NotificationEventType = z.infer<typeof notificationEventTypeSchema>;

export const notificationSeveritySchema = z.enum(['normal', 'emergency']);
export type NotificationSeverity = z.infer<typeof notificationSeveritySchema>;

export const notificationSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  eventType: notificationEventTypeSchema,
  category: notificationCategorySchema,
  severity: notificationSeveritySchema,
  payload: z.record(z.string(), z.unknown()),
  readAt: z.string().datetime().nullable(),
  dismissedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  nextCursor: z.string().uuid().nullable(),
  unreadCount: z.number().int(),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const unreadNotificationCountResponseSchema = z.object({
  count: z.number().int(),
});
export type UnreadNotificationCountResponse = z.infer<typeof unreadNotificationCountResponseSchema>;
