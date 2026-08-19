import { z } from 'zod';
import { languageSchema, teamAccentColorSchema, teamRoleSchema } from './enums';

export const userSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  languagePreference: languageSchema,
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const teamMembershipSchema = z.object({
  teamId: z.string().uuid(),
  teamName: z.string(),
  role: teamRoleSchema,
  timezone: z.string(),
  primaryColor: teamAccentColorSchema.nullable(),
});
export type TeamMembership = z.infer<typeof teamMembershipSchema>;
