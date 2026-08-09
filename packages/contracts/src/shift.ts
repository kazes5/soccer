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
