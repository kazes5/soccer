import { z } from 'zod';

export const playerSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  // Describes what's actually storable (Player.age has no DB check
  // constraint), not the stricter business rule new registrations enforce
  // (see acceptInvitePlayerSchema below) — a response schema that's tighter
  // than the column would make a future admin-edit or backfill path that
  // legitimately produces age 0 fail every roster read for that team.
  age: z.number().int().nonnegative().nullable(),
});
export type PlayerSummary = z.infer<typeof playerSummarySchema>;

export const playerListResponseSchema = z.object({
  players: z.array(playerSummarySchema),
});
export type PlayerListResponse = z.infer<typeof playerListResponseSchema>;

export const acceptInvitePlayerSchema = z.object({
  name: z.string().min(1).max(255),
  age: z.number().int().positive().max(25).optional(),
});
export type AcceptInvitePlayer = z.infer<typeof acceptInvitePlayerSchema>;
