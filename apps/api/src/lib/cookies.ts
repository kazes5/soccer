import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env';
import { HttpError } from './errors';

export const SESSION_COOKIE_NAME = 'soccer_session';
export const CSRF_COOKIE_NAME = 'soccer_csrf';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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

/** Sets the httpOnly session cookie and a readable CSRF cookie for the same session lifetime. */
export function setSessionCookies(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    ...baseCookieOptions(),
    httpOnly: true,
    expires: expiresAt,
  });
  reply.setCookie(CSRF_COOKIE_NAME, generateCsrfToken(), {
    ...baseCookieOptions(),
    httpOnly: false,
    expires: expiresAt,
  });
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
 */
export function assertCsrfSafe(request: FastifyRequest): void {
  if (!MUTATING_METHODS.has(request.method)) return;
  if (request.headers.authorization) return;

  const sessionCookie = request.cookies[SESSION_COOKIE_NAME];
  if (!sessionCookie) return;

  const csrfCookie = request.cookies[CSRF_COOKIE_NAME];
  const csrfHeader = request.headers['x-csrf-token'];
  if (!csrfCookie || csrfHeader !== csrfCookie) {
    throw new HttpError(403, 'Missing or invalid CSRF token.');
  }
}
