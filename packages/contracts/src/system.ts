import { z } from 'zod';
import { systemRoleSchema, teamRoleSchema } from './enums';

export const systemOverviewSchema = z.object({
  teams: z.number().int().nonnegative(),
  users: z.number().int().nonnegative(),
  teamAdmins: z.number().int().nonnegative(),
  systemAdmins: z.number().int().nonnegative(),
});
export type SystemOverview = z.infer<typeof systemOverviewSchema>;

export const systemTeamSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  season: z.string(),
  timezone: z.string(),
  memberCount: z.number().int().nonnegative(),
  adminCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type SystemTeam = z.infer<typeof systemTeamSchema>;
export const systemTeamListResponseSchema = z.object({
  teams: z.array(systemTeamSchema),
  nextCursor: z.string().uuid().nullable().optional(),
});
export type SystemTeamListResponse = z.infer<typeof systemTeamListResponseSchema>;

export const systemUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  isActive: z.boolean(),
  systemRole: systemRoleSchema.nullable(),
  hasPasskey: z.boolean(),
  membershipCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type SystemUser = z.infer<typeof systemUserSchema>;
export const systemUserListResponseSchema = z.object({
  users: z.array(systemUserSchema),
  nextCursor: z.string().uuid().nullable().optional(),
});
export type SystemUserListResponse = z.infer<typeof systemUserListResponseSchema>;

export const systemTeamMemberSchema = systemUserSchema
  .pick({
    id: true,
    name: true,
    phone: true,
    email: true,
    isActive: true,
    systemRole: true,
    hasPasskey: true,
  })
  .extend({ role: teamRoleSchema, joinedAt: z.string().datetime() });
export type SystemTeamMember = z.infer<typeof systemTeamMemberSchema>;
export const systemTeamMemberListResponseSchema = z.object({
  members: z.array(systemTeamMemberSchema),
});
export type SystemTeamMemberListResponse = z.infer<typeof systemTeamMemberListResponseSchema>;

export const updateSystemRoleRequestSchema = z.object({
  systemRole: systemRoleSchema.nullable(),
});
export type UpdateSystemRoleRequest = z.infer<typeof updateSystemRoleRequestSchema>;

export const systemAuditEntrySchema = z.object({
  id: z.string().uuid(),
  actorName: z.string().nullable(),
  actionType: z.string(),
  targetEntity: z.string(),
  targetId: z.string().nullable(),
  teamId: z.string().nullable(),
  beforeState: z.unknown().nullable(),
  afterState: z.unknown().nullable(),
  createdAt: z.string().datetime(),
});
export const systemAuditListResponseSchema = z.object({
  entries: z.array(systemAuditEntrySchema),
  nextCursor: z.string().uuid().nullable().optional(),
});
export type SystemAuditListResponse = z.infer<typeof systemAuditListResponseSchema>;
