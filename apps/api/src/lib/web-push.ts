import webpush, { WebPushError } from 'web-push';
import { env } from '../env';

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type WebPushSendResult =
  { ok: true } | { ok: false; shouldRemoveSubscription: boolean; error: string };

/**
 * Thin wrapper around the `web-push` npm package so it can be swapped out in
 * tests — a real send needs a real push service (and, for encryption, a real
 * subscriber keypair) that Vitest can't produce, the same reason
 * `WebauthnVerifier` is injectable. Consumed as a plain constructor argument
 * (like `IORedis` publisher connections elsewhere in this codebase) rather
 * than a Fastify decorator, because sends happen from the worker process,
 * which never calls `buildApp()`.
 */
export interface WebPushProvider {
  /** False when VAPID isn't configured — callers should skip push entirely
   *  rather than attempt a send that can only fail. */
  readonly isConfigured: boolean;
  send(subscription: PushSubscriptionKeys, payload: string): Promise<WebPushSendResult>;
}

export class VapidWebPushProvider implements WebPushProvider {
  readonly isConfigured: boolean;

  constructor() {
    this.isConfigured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
    if (this.isConfigured) {
      webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
    }
  }

  async send(subscription: PushSubscriptionKeys, payload: string): Promise<WebPushSendResult> {
    if (!this.isConfigured) {
      return { ok: false, shouldRemoveSubscription: false, error: 'VAPID is not configured.' };
    }
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload,
      );
      return { ok: true };
    } catch (error) {
      if (error instanceof WebPushError) {
        // 404/410 is the push service's standard way of saying this
        // subscription no longer exists (browser uninstalled, permission
        // revoked, endpoint rotated) — the signal to stop sending to it.
        const shouldRemoveSubscription = error.statusCode === 404 || error.statusCode === 410;
        return {
          ok: false,
          shouldRemoveSubscription,
          error: `HTTP ${error.statusCode}: ${error.body}`,
        };
      }
      return {
        ok: false,
        shouldRemoveSubscription: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
