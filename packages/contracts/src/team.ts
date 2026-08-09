import { z } from 'zod';
import { languageSchema } from './enums';
import { userSummarySchema } from './user';

export const teamSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  season: z.string(),
  timezone: z.string(),
});
export type TeamSummary = z.infer<typeof teamSummarySchema>;

export const createTeamRequestSchema = z
  .object({
    teamName: z.string().min(1).max(255),
    season: z.string().min(1).max(50),
    timezone: z.string().min(1).default('Asia/Jerusalem'),
    adminName: z.string().min(1).max(255),
    adminPhone: z.string().min(1).max(20).optional(),
    adminEmail: z.string().email().optional(),
    adminLanguage: languageSchema.default('en'),
  })
  .refine((data) => Boolean(data.adminPhone ?? data.adminEmail), {
    message: 'Provide adminPhone or adminEmail.',
    path: ['adminPhone'],
  });
export type CreateTeamRequest = z.input<typeof createTeamRequestSchema>;

export const createTeamResponseSchema = z.object({
  team: teamSummarySchema,
  admin: userSummarySchema,
  sessionToken: z.string(),
  sessionExpiresAt: z.string().datetime(),
});
export type CreateTeamResponse = z.infer<typeof createTeamResponseSchema>;
