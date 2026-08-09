import { z } from 'zod';
import { languageSchema } from './enums';
import { acceptInvitePlayerSchema, playerSummarySchema } from './player';
import { teamSummarySchema } from './team';
import { userSummarySchema } from './user';

export const inviteStatusSchema = z.enum(['pending', 'accepted', 'expired', 'revoked']);
export type InviteStatus = z.infer<typeof inviteStatusSchema>;

export const createInviteRequestSchema = z
  .object({
    phone: z.string().min(1).max(20).optional(),
    email: z.string().email().optional(),
    expiresInDays: z.number().int().positive().max(90).default(7),
  })
  .refine((data) => Boolean(data.phone ?? data.email), {
    message: 'Provide phone or email.',
    path: ['phone'],
  });
export type CreateInviteRequest = z.input<typeof createInviteRequestSchema>;

export const inviteSummarySchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  code: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  status: inviteStatusSchema,
  expiresAt: z.string().datetime(),
});
export type InviteSummary = z.infer<typeof inviteSummarySchema>;

export const invitePreviewSchema = z.object({
  status: inviteStatusSchema,
  expiresAt: z.string().datetime(),
  team: z.object({ id: z.string().uuid(), name: z.string() }),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

export const acceptInviteRequestSchema = z.object({
  name: z.string().min(1).max(255),
  language: languageSchema.default('en'),
  players: z.array(acceptInvitePlayerSchema).default([]),
});
export type AcceptInviteRequest = z.input<typeof acceptInviteRequestSchema>;

export const acceptInviteResponseSchema = z.object({
  user: userSummarySchema,
  team: teamSummarySchema,
  players: z.array(playerSummarySchema),
});
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>;
