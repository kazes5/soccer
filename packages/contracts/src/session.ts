import { z } from 'zod';
import { sessionStatusSchema, shiftDirectionSchema } from './enums';
import { shiftSummarySchema } from './shift';

export const sessionPointSchema = z.object({
  pointId: z.string().uuid(),
  pointName: z.string(),
  direction: shiftDirectionSchema,
  playerIds: z.array(z.string().uuid()),
  shift: shiftSummarySchema,
});
export type SessionPoint = z.infer<typeof sessionPointSchema>;

export const practiceSessionSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  templateId: z.string().uuid().nullable(),
  startsAt: z.string().datetime(),
  fieldLocation: z.string(),
  status: sessionStatusSchema,
  points: z.array(sessionPointSchema),
});
export type PracticeSession = z.infer<typeof practiceSessionSchema>;

export const sessionListResponseSchema = z.object({
  sessions: z.array(practiceSessionSchema),
});
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;

export const updateSessionRequestSchema = z.object({
  startsAt: z.string().datetime().optional(),
  fieldLocation: z.string().min(1).max(255).optional(),
});
export type UpdateSessionRequest = z.infer<typeof updateSessionRequestSchema>;

export const updateSessionPointPlayersRequestSchema = z.object({
  direction: shiftDirectionSchema,
  playerIds: z.array(z.string().uuid()),
});
export type UpdateSessionPointPlayersRequest = z.infer<
  typeof updateSessionPointPlayersRequestSchema
>;
