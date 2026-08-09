import { z } from 'zod';

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
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>;

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
