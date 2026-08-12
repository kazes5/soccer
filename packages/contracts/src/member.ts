import { z } from 'zod';
import { teamRoleSchema } from './enums';

export const updateMemberRoleRequestSchema = z.object({
  role: teamRoleSchema,
});
export type UpdateMemberRoleRequest = z.infer<typeof updateMemberRoleRequestSchema>;

export const updateMemberRoleResponseSchema = z.object({
  userId: z.string().uuid(),
  role: teamRoleSchema,
});
export type UpdateMemberRoleResponse = z.infer<typeof updateMemberRoleResponseSchema>;

export const teamMemberSummarySchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  role: teamRoleSchema,
  joinedAt: z.string().datetime(),
});
export type TeamMemberSummary = z.infer<typeof teamMemberSummarySchema>;

export const teamMemberListResponseSchema = z.object({
  members: z.array(teamMemberSummarySchema),
});
export type TeamMemberListResponse = z.infer<typeof teamMemberListResponseSchema>;

/**
 * Deliberately narrower than `teamMemberSummarySchema` — no `phone`/`email`.
 * `GET /teams/:teamId/members` (the full record) is admin-only for a reason
 * (CLAUDE.md §4.1: "No public roster or user directory"); this is the
 * parent-readable roster view, so it must never carry contact details.
 */
export const teamRosterEntrySchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  role: teamRoleSchema,
});
export type TeamRosterEntry = z.infer<typeof teamRosterEntrySchema>;

export const teamRosterResponseSchema = z.object({
  members: z.array(teamRosterEntrySchema),
});
export type TeamRosterResponse = z.infer<typeof teamRosterResponseSchema>;
