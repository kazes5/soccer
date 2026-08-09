import { z } from 'zod';
import { teamRoleSchema } from './enums';

export const updateMemberRoleRequestSchema = z.object({
  role: teamRoleSchema,
});
export type UpdateMemberRoleRequest = z.infer<typeof updateMemberRoleRequestSchema>;

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
