import { api } from './api';

export type PushStatus =
  'unsupported' | 'denied' | 'default' | 'granted-not-subscribed' | 'subscribed';

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** The standard VAPID-key conversion every Web Push client needs —
 * `pushManager.subscribe()` requires a `Uint8Array`, but the server hands
 * back the key as a URL-safe base64 string. Exported for direct unit
 * testing, since it's the one piece of this module pure enough not to need
 * `EventSource`/`BroadcastChannel`-style browser APIs jsdom doesn't
 * implement. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** The current state across three independent axes (browser support,
 * `Notification.permission`, and whether we've actually created a
 * subscription) collapsed into one value the settings UI can switch on. */
export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default') return 'default';

  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? 'subscribed' : 'granted-not-subscribed';
}

export class PushPermissionDeniedError extends Error {}
export class PushUnavailableError extends Error {}

/** Requests permission (if not already granted), registers the service
 * worker, subscribes via the browser's PushManager, and registers the
 * subscription with the server — the full explicit opt-in flow, matching
 * this checkpoint's "explicit permission/subscription UI" requirement (no
 * silent auto-subscribe). */
export async function enablePush(): Promise<void> {
  if (!isPushSupported()) {
    throw new PushUnavailableError('Push notifications are not supported in this browser.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new PushPermissionDeniedError('Push notification permission was not granted.');
  }

  const { publicKey } = await api.getPushConfig();
  if (!publicKey) {
    throw new PushUnavailableError('Push notifications are not available right now.');
  }

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    // TS's DOM lib types `applicationServerKey` as `BufferSource`, which
    // (as of the TS version this project pins) excludes a `Uint8Array`
    // whose backing buffer type isn't narrowed to plain `ArrayBuffer` —
    // `new Uint8Array(length)` always allocates one, this is a type-only
    // mismatch, not a runtime concern.
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new PushUnavailableError('The browser returned an incomplete push subscription.');
  }
  await api.createPushSubscription({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
}

/** Unsubscribes on this device and tells the server to forget the
 * subscription. A no-op (not an error) if there was never one. */
export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await api.deletePushSubscription({ endpoint });
}
