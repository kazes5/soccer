// Browser push service worker. Kept as a plain, unbundled static file (not
// processed by Next.js) so it can register at the root scope (`/`) and stays
// simple enough to audit without a build step.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  const title = typeof payload.title === 'string' ? payload.title : 'Soccer Carpool Coordinator';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const url = typeof payload.url === 'string' ? payload.url : null;

  event.waitUntil(
    (async () => {
      // "Active visible tabs receive the in-app event instead of a
      // duplicate OS notification" (Stage 4 Detailed Implementation Plan,
      // Checkpoint 6) — the live SSE stream already updated any open,
      // focused tab, so showing an OS notification on top would be
      // redundant. Only skip when a client is actually focused, not merely
      // open in the background.
      const clientsList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      if (clientsList.some((client) => client.focused)) return;

      await self.registration.showNotification(title, { body, data: { url } });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data && event.notification.data.url;
  // Only ever navigate to a validated app-relative path, never an
  // absolute/external URL — defense in depth mirroring
  // apps/web/src/lib/safe-redirect.ts, even though this payload came from
  // our own server.
  const safePath =
    typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && !url.includes('://')
      ? url
      : '/home';

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of clientsList) {
        if (
          client.url &&
          new URL(client.url).origin === self.location.origin &&
          'focus' in client
        ) {
          await client.focus();
          if ('navigate' in client) {
            await client.navigate(safePath).catch(() => {});
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(safePath);
      }
    })(),
  );
});
