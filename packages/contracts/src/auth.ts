import { z } from 'zod';
import { teamMembershipSchema, userSummarySchema } from './user';

export const requestOtpRequestSchema = z
  .object({
    phone: z.string().min(1).max(20).optional(),
    email: z.string().email().optional(),
  })
  .refine((data) => Boolean(data.phone ?? data.email), {
    message: 'Provide phone or email.',
    path: ['phone'],
  });
export type RequestOtpRequest = z.infer<typeof requestOtpRequestSchema>;

export const requestOtpResponseSchema = z.object({
  challengeId: z.string().uuid(),
  expiresAt: z.string().datetime(),
});
export type RequestOtpResponse = z.infer<typeof requestOtpResponseSchema>;

export const verifyOtpRequestSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().length(6),
});
export type VerifyOtpRequest = z.infer<typeof verifyOtpRequestSchema>;

export const verifyOtpResponseSchema = z.object({
  sessionToken: z.string(),
  expiresAt: z.string().datetime(),
  user: userSummarySchema,
  teamMemberships: z.array(teamMembershipSchema),
});
export type VerifyOtpResponse = z.infer<typeof verifyOtpResponseSchema>;
