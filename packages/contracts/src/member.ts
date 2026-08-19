import { z } from 'zod';
import { languageSchema, teamRoleSchema } from './enums';
import { acceptInvitePlayerSchema } from './player';

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

/** Admin directly creating a parent account with a password of their choosing
 *  — an alternative to the invite-link flow, not a replacement for it. */
export const addParentRequestSchema = z
  .object({
    name: z.string().min(1).max(255),
    phone: z.string().min(1).max(20).optional(),
    email: z.string().email().optional(),
    language: languageSchema.default('en'),
    password: z.string().min(15).max(128),
    passwordConfirmation: z.string().min(1).max(128),
    players: z.array(acceptInvitePlayerSchema).default([]),
  })
  .refine((data) => Number(Boolean(data.phone)) + Number(Boolean(data.email)) === 1, {
    message: 'Provide exactly one of phone or email.',
    path: ['phone'],
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: 'Passwords do not match.',
    path: ['passwordConfirmation'],
  });
export type AddParentRequest = z.input<typeof addParentRequestSchema>;
export const addParentResponseSchema = teamMemberSummarySchema;
export type AddParentResponse = z.infer<typeof addParentResponseSchema>;
