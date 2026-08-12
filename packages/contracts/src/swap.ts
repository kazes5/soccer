import { z } from 'zod';
import { shiftDirectionSchema, swapRequestStatusSchema } from './enums';

/**
 * A one-way request to take over another parent's claimed shift (CLAUDE.md
 * §3.4). Flattened shift/session/point/user fields for display, mirroring
 * `ShiftSummary`/`PracticeSession`'s DTO convention — no nested joins the
 * client would have to resolve itself.
 */
export const swapRequestSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  shiftId: z.string().uuid(),
  sessionId: z.string().uuid(),
  sessionStartsAt: z.string().datetime(),
  pointId: z.string().uuid(),
  pointName: z.string(),
  direction: shiftDirectionSchema,
  requestingUserId: z.string().uuid(),
  requestingUserName: z.string(),
  currentHolderId: z.string().uuid(),
  currentHolderName: z.string(),
  status: swapRequestStatusSchema,
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SwapRequest = z.infer<typeof swapRequestSchema>;

export const swapRequestListResponseSchema = z.object({
  swapRequests: z.array(swapRequestSchema),
});
export type SwapRequestListResponse = z.infer<typeof swapRequestListResponseSchema>;
