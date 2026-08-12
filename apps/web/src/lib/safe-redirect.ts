/**
 * Validates a `next` redirect target so `/login?next=...` can only ever send
 * an authenticated user to a path within this app, never to an attacker-
 * controlled external URL (`https://evil.example`) or a scheme that could be
 * abused (`javascript:...`). Falls back to `/home` for anything that isn't a
 * plain, single-leading-slash app-relative path.
 */
export function safeNextPath(raw: string | null): string {
  if (!raw) return '/home';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('://')) return '/home';
  return raw;
}

/** Builds a `/login?next=...` target carrying the current path (including
 * its own query string, e.g. a deep link's `session`/`shift` params) back
 * through the login redirect, so following a deep link while logged out
 * still lands on the right place after authenticating. */
export function buildLoginRedirect(pathname: string, search: string): string {
  const next = search ? `${pathname}?${search}` : pathname;
  return `/login?next=${encodeURIComponent(next)}`;
}
