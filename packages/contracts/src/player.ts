import { z } from 'zod';

export const playerSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  age: z.number().int().positive().nullable(),
});
export type PlayerSummary = z.infer<typeof playerSummarySchema>;

export const acceptInvitePlayerSchema = z.object({
  name: z.string().min(1).max(255),
  age: z.number().int().positive().max(25).optional(),
});
export type AcceptInvitePlayer = z.infer<typeof acceptInvitePlayerSchema>;
