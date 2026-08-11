import { type Notification, notificationSchema } from '@soccer/contracts';

interface LeaderMessage {
  type: 'notification';
  notification: Notification;
}

export interface NotificationStreamHandlers {
  onNotification: (notification: Notification) => void;
}

/**
 * De-dupes by notification id so the same event received twice — e.g. once
 * live and once via reconnect replay — is only applied once. Exported
 * separately from the browser-API orchestration below so it's unit-testable
 * without EventSource/BroadcastChannel/Web Locks, none of which jsdom
 * implements.
 */
export function shouldApply(seenIds: Set<string>, notification: Notification): boolean {
  if (seenIds.has(notification.id)) return false;
  seenIds.add(notification.id);
  return true;
}

/**
 * Opens (or joins) this team's live notification stream for the current
 * browser session, per ADR 0001: one `EventSource` per user, elected via the
 * Web Locks API so N open tabs don't open N redundant connections, with the
 * elected leader rebroadcasting every event to sibling tabs over
 * `BroadcastChannel`. Returns a cleanup function that releases the tab's
 * involvement (closing its `EventSource` if it was the leader, or just its
 * `BroadcastChannel` listener if it wasn't).
 *
 * Falls back to every tab running its own `EventSource` when Web Locks isn't
 * available — functionally correct, just not connection-count-optimal.
 */
export function startNotificationStream(
  apiBaseUrl: string,
  teamId: string,
  handlers: NotificationStreamHandlers,
): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return () => {};

  const seenIds = new Set<string>();
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(`notifications:${teamId}`) : null;
  let eventSource: EventSource | null = null;
  let stopped = false;
  let releaseLock: (() => void) | null = null;

  function apply(notification: Notification) {
    if (shouldApply(seenIds, notification)) handlers.onNotification(notification);
  }

  function handleChannelMessage(event: MessageEvent<LeaderMessage>) {
    if (event.data.type === 'notification') apply(event.data.notification);
  }
  channel?.addEventListener('message', handleChannelMessage);

  // Held for as long as its returned promise stays pending; resolving it
  // (via the returned cleanup function, or the browser force-releasing the
  // lock on tab close) frees the lock so the next-queued tab is granted it
  // and becomes the new leader — the documented Web Locks leader-election
  // pattern, not a bespoke protocol.
  function becomeLeader(): Promise<void> {
    return new Promise((resolve) => {
      if (stopped) {
        resolve();
        return;
      }
      eventSource = new EventSource(
        `${apiBaseUrl}/teams/${encodeURIComponent(teamId)}/notifications/stream`,
        { withCredentials: true },
      );
      eventSource.addEventListener('notification', (event) => {
        const messageEvent = event as MessageEvent<string>;
        let parsed: unknown;
        try {
          parsed = JSON.parse(messageEvent.data);
        } catch {
          return;
        }
        const result = notificationSchema.safeParse(parsed);
        // A stale open tab may not recognize a newer server-side event type
        // (or vice versa mid-deploy) — drop it rather than crash the stream.
        if (!result.success) return;
        apply(result.data);
        channel?.postMessage({ type: 'notification', notification: result.data } satisfies LeaderMessage);
      });
      releaseLock = () => {
        eventSource?.close();
        eventSource = null;
        resolve();
      };
    });
  }

  if ('locks' in navigator) {
    void navigator.locks.request(`sse-notifications:${teamId}`, becomeLeader);
  } else {
    void becomeLeader();
  }

  return () => {
    stopped = true;
    channel?.removeEventListener('message', handleChannelMessage);
    channel?.close();
    releaseLock?.();
  };
}
