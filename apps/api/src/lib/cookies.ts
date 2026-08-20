import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env';
import { HttpError } from './errors';

export const SESSION_COOKIE_NAME = 'soccer_session';
export const CSRF_COOKIE_NAME = 'soccer_csrf';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Routes that establish or reset credentials themselves and never call
 * `requireAuth` — they don't act on whatever session the browser happens to
 * be carrying, so there's nothing for CSRF to protect even if an unrelated
 * *valid* session cookie is present (e.g. a different account still logged
 * in on the same browser, or a first-time visitor who never had a reason to
 * fetch a CSRF token yet). See `assertCsrfSafe`'s doc comment.
 */
const CSRF_EXEMPT_ROUTES = new Set([
  '/auth/password/login',
  '/auth/password/forgot',
  '/auth/password/reset',
  '/teams',
  '/invites/:code/verify-code',
  '/invites/:code/complete-password-onboarding',
]);

function baseCookieOptions() {
  const secure = env.NODE_ENV === 'production';
  return {
    path: '/',
    // The web and API deployments live on different Railway-generated
    // domains (soccerweb-production.up.railway.app vs
    // soccerapi-production.up.railway.app) — genuinely cross-site from the
    // browser's perspective, not just cross-origin. A `Lax` cookie is never
    // attached to a cross-site fetch()/XHR call (only to a top-level link
    // navigation), so the session cookie set here would never make it back
    // on the client's very next `/auth/me` call: login would appear to
    // succeed but every follow-up request would 401. `None` is required for
    // that cross-site fetch to carry the cookie, and the spec requires
    // `Secure` alongside it — which production already sets. Same-origin
    // localhost dev (only the port differs) stays `Lax`, since `None`
    // requires `Secure`, and dev has no TLS.
    sameSite: secure ? ('none' as const) : ('lax' as const),
    secure,
  };
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Sets the httpOnly session cookie and a readable CSRF cookie for the same
 * session lifetime, and returns the CSRF token so the caller can also hand
 * it back in the JSON response body. The web and API are on different
 * Railway domains (see baseCookieOptions above), so `document.cookie` on
 * the web page can never see a cookie set by the API — cookie reads are
 * strictly same-origin, unrelated to SameSite. The response body is the
 * only channel the frontend actually has for this value; see
 * apps/web/src/lib/api.ts's cached-from-response-body token handling.
 */
export function setSessionCookies(reply: FastifyReply, token: string, expiresAt: Date): string {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    ...baseCookieOptions(),
    httpOnly: true,
    expires: expiresAt,
  });
  const csrfToken = generateCsrfToken();
  reply.setCookie(CSRF_COOKIE_NAME, csrfToken, {
    ...baseCookieOptions(),
    httpOnly: false,
    expires: expiresAt,
  });
  return csrfToken;
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  reply.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
}

/** Prefers an explicit bearer token (non-browser clients) over the session cookie. */
export function resolveSessionToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : request.cookies[SESSION_COOKIE_NAME];
}

/**
 * Double-submit CSRF check for cookie-authenticated (browser) requests only. Bearer-token
 * requests (curl, tests, future non-browser clients) aren't automatically replayed by a
 * browser, so they aren't CSRF-vulnerable and are exempt.
 *
 * Gated on `request.currentUser` (set by `plugins/auth.ts`'s `onRequest` hook, which
 * `app.ts` registers *before* this one runs — see its `app.register(authPlugin)` /
 * `app.addHook('onRequest', ...)` ordering) rather than raw cookie presence. CSRF
 * protection exists to stop a forged request from riding on an *already-authenticated*
 * session — if the session isn't actually valid (revoked, expired, deactivated user),
 * there's no authenticated action to protect, so this must not gate on it. Checking
 * cookie presence instead of validity previously meant a stale `soccer_session` cookie
 * left over from a revoked/expired session — one the browser keeps sending regardless
 * of server-side validity — permanently blocked login itself (and every other
 * unauthenticated endpoint) with "Missing or invalid CSRF token", since the frontend has
 * no CSRF token to send until a request like login actually succeeds. Found in
 * production 2026-08-20; see docs/deployment.md's "Post-launch incidents" section.
 *
 * The `currentUser` check alone isn't sufficient, though: it only proves *some*
 * session cookie is valid, not that the request is acting on it. A browser that
 * already has a genuinely valid (non-stale) session for one account — from a
 * previous login, a different accepted invite, or simply never logging out —
 * still carries that cookie when POSTing to `/auth/password/login`,
 * `/teams` (team creation), or a password-reset endpoint on a *fresh page
 * load*, before the frontend has cached any CSRF token to send. Those routes
 * never call `requireAuth`, so the existing session (valid or not) is
 * irrelevant to what they do — see `CSRF_EXEMPT_ROUTES` above. Found in
 * production 2026-08-21.
 */
export function assertCsrfSafe(request: FastifyRequest): void {
  if (!MUTATING_METHODS.has(request.method)) return;
  if (request.headers.authorization) return;
  if (!request.currentUser) return;
  if (CSRF_EXEMPT_ROUTES.has(request.routeOptions.url ?? '')) return;

  const csrfCookie = request.cookies[CSRF_COOKIE_NAME];
  const csrfHeader = request.headers['x-csrf-token'];
  if (!csrfCookie || csrfHeader !== csrfCookie) {
    throw new HttpError(403, 'Missing or invalid CSRF token.');
  }
}
