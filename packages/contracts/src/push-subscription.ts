import { z } from 'zod';

export const createPushSubscriptionRequestSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type CreatePushSubscriptionRequest = z.infer<typeof createPushSubscriptionRequestSchema>;

export const deletePushSubscriptionRequestSchema = z.object({
  endpoint: z.string().url(),
});
export type DeletePushSubscriptionRequest = z.infer<typeof deletePushSubscriptionRequestSchema>;

/** `publicKey` is `null` when the server has no VAPID key pair configured —
 * push is then simply unavailable; the client should not attempt to
 * subscribe (see `docs/installation.md` for how to generate a local one). */
export const pushConfigResponseSchema = z.object({
  publicKey: z.string().nullable(),
});
export type PushConfigResponse = z.infer<typeof pushConfigResponseSchema>;
