import { z } from 'zod';
import { shiftDirectionSchema, shiftStatusSchema } from './enums';

export const shiftSummarySchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  pointId: z.string().uuid(),
  direction: shiftDirectionSchema,
  status: shiftStatusSchema,
  assignedUserId: z.string().uuid().nullable(),
  assignedUserName: z.string().nullable(),
  version: z.number().int(),
});
export type ShiftSummary = z.infer<typeof shiftSummarySchema>;

const shiftCountsSchema = z.object({
  toPractice: z.number(),
  fromPractice: z.number(),
  total: z.number(),
});

/**
 * `mine` is exact counts (integers); `teamAverage` is total-claimed divided by
 * team member count, so it's a float the client rounds for display. Computed
 * server-side so a non-admin caller never needs the team roster itself —
 * CLAUDE.md's Requirement 13 keeps individual member stats admin-only while
 * still letting every parent see the team average for self-comparison.
 */
export const shiftStatsResponseSchema = z.object({
  mine: shiftCountsSchema,
  teamAverage: shiftCountsSchema,
});
export type ShiftStatsResponse = z.infer<typeof shiftStatsResponseSchema>;
