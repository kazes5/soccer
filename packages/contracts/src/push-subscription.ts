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
