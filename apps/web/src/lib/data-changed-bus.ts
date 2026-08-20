'use client';

import { useEffect } from 'react';

/**
 * A same-tab signal for "something a team member did probably changed the
 * schedule/shift/swap data this page is showing — quietly refetch it."
 *
 * Chat runs in a persistent bubble mounted once in AppShell (chat-bubble.tsx),
 * entirely separate from whatever page's own React tree is currently
 * mounted underneath it — a successful claim/release/swap made through chat
 * has no way to reach an already-rendered Schedule/Home page's local state
 * on its own, so without this, the change is real (and other team members
 * see it live via the existing notification broadcast) but the *acting*
 * user's own currently-open page still shows the pre-action state until a
 * manual reload. Deliberately not wired to the notification SSE stream
 * (apps/web/src/lib/sse.ts) — that's a team-wide, cross-tab broadcast with
 * its own leader-election machinery, more than this same-tab, own-action
 * case needs; a plain window CustomEvent is enough here.
 */
const EVENT_NAME = 'soccer:data-changed';

export function broadcastDataChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(EVENT_NAME));
}

/** Calls `onChanged` (expected to be a quiet, no-spinner refetch — e.g. a
 *  page's existing `refreshSilently`/reconnect-handler function) whenever
 *  `broadcastDataChanged` fires anywhere in this tab. */
export function useOnDataChanged(onChanged: () => void): void {
  useEffect(() => {
    window.addEventListener(EVENT_NAME, onChanged);
    return () => window.removeEventListener(EVENT_NAME, onChanged);
  }, [onChanged]);
}
