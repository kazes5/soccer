import { z } from 'zod';

/**
 * Chat history is client-side only and ephemeral (never persisted server-side
 * — see PLAN.md's Stage 7 AI-chat checkpoint decision record) — the client
 * replays whatever turns it's still holding on each request. Capped short:
 * this is context for the model, not a transcript archive, and every extra
 * turn is tokens billed to OPENROUTER_API_KEY.
 */
export const chatTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(4000),
});
export type ChatTurn = z.infer<typeof chatTurnSchema>;

export const chatMessageRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z.array(chatTurnSchema).max(20).default([]),
  locale: z.enum(['en', 'he']).default('en'),
  // Present only when replying to a `confirmation-required` event's inline
  // Yes affordance — see chat-confirmation.ts. No shipped tool sets
  // `confirmationRequired` yet, so no real request populates this today.
  confirmedToken: z.string().optional(),
});
export type ChatMessageRequest = z.infer<typeof chatMessageRequestSchema>;

// SSE event payloads, one schema per `event:` name the chat stream emits —
// validated on the client the same "safeParse, drop unknown" way
// apps/web/src/lib/sse.ts already validates notification events.
export const chatTextDeltaEventSchema = z.object({ delta: z.string() });
export type ChatTextDeltaEvent = z.infer<typeof chatTextDeltaEventSchema>;

export const chatToolCallEventSchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
});
export type ChatToolCallEvent = z.infer<typeof chatToolCallEventSchema>;

export const chatToolResultEventSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  summary: z.string(),
});
export type ChatToolResultEvent = z.infer<typeof chatToolResultEventSchema>;

export const chatConfirmationRequiredEventSchema = z.object({
  token: z.string(),
  summary: z.string(),
});
export type ChatConfirmationRequiredEvent = z.infer<typeof chatConfirmationRequiredEventSchema>;

export const chatErrorEventSchema = z.object({ message: z.string() });
export type ChatErrorEvent = z.infer<typeof chatErrorEventSchema>;
