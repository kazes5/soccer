import { z } from 'zod';
import { languageSchema, teamAccentColorSchema } from './enums';
import { userSummarySchema } from './user';

export const teamSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  season: z.string(),
  timezone: z.string(),
  primaryColor: teamAccentColorSchema.nullable(),
});
export type TeamSummary = z.infer<typeof teamSummarySchema>;

/** Team-admin or system-admin only — see PATCH /teams/:teamId/accent-color. */
export const updateTeamAccentColorRequestSchema = z.object({
  primaryColor: teamAccentColorSchema.nullable(),
});
export type UpdateTeamAccentColorRequest = z.infer<typeof updateTeamAccentColorRequestSchema>;

export const createTeamRequestSchema = z
  .object({
    teamName: z.string().min(1).max(255),
    season: z.string().min(1).max(50),
    timezone: z.string().min(1).default('Asia/Jerusalem'),
    adminName: z.string().min(1).max(255),
    adminPhone: z.string().min(1).max(20).optional(),
    adminEmail: z.string().email().optional(),
    adminLanguage: languageSchema.default('en'),
    adminPassword: z.string().min(15).max(128),
    adminPasswordConfirmation: z.string().min(1).max(128),
  })
  .refine((data) => Boolean(data.adminPhone ?? data.adminEmail), {
    message: 'Provide adminPhone or adminEmail.',
    path: ['adminPhone'],
  })
  .refine((data) => data.adminPassword === data.adminPasswordConfirmation, {
    message: 'Passwords do not match.',
    path: ['adminPasswordConfirmation'],
  });
export type CreateTeamRequest = z.input<typeof createTeamRequestSchema>;

// csrfToken: see auth.ts's authSessionResponseSchema doc — same reasoning,
// this also establishes a new session via setSessionCookies.
export const createTeamResponseSchema = z.object({
  team: teamSummarySchema,
  admin: userSummarySchema,
  sessionToken: z.string(),
  sessionExpiresAt: z.string().datetime(),
  csrfToken: z.string(),
});
export type CreateTeamResponse = z.infer<typeof createTeamResponseSchema>;
