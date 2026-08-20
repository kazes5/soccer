import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless confirmation tokens for destructive chat tools — no tool ships
 * with `confirmationRequired: true` yet (see chat-tools.ts), so this
 * mechanism is currently only exercised by tests, built now so it's ready
 * for the admin-action follow-up per CLAUDE.md §6.4.
 *
 * Deliberately stateless (HMAC-signed, self-verifying) rather than a
 * server-side store: the token itself is proof of what was proposed and
 * when, so there's no Redis/DB row to expire or clean up, and — critically —
 * the model's own read of "did the user say yes" never gates execution.
 * Only a real client action (a button send-back of this exact token) can
 * trigger the confirmed call; the server independently re-verifies the
 * signature and expiry rather than trusting the client's say-so.
 *
 * The signing `secret` is always an explicit parameter, never read from
 * `env` internally — callers resolve it from `app.chatConfirmationSecret`
 * (app.ts), which is instance-level like `app.openRouterApiKey`, so tests
 * can supply a fake value without mutating shared process env.
 */
const TTL_MS = 5 * 60 * 1000;

export interface ConfirmationPayload {
  userId: string;
  teamId: string;
  toolName: string;
  /** Canonical (stable key order) JSON of the tool call's arguments — part
   *  of what's signed, so a token can't be replayed against different args. */
  argsJson: string;
}

function sign(payload: ConfirmationPayload, expiresAt: number, secret: string): string {
  const body = JSON.stringify({ ...payload, expiresAt });
  const bodyBase64 = Buffer.from(body, 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(bodyBase64).digest('base64url');
  return `${bodyBase64}.${signature}`;
}

export function createConfirmationToken(payload: ConfirmationPayload, secret: string): string {
  return sign(payload, Date.now() + TTL_MS, secret);
}

/** Verifies the token's signature, expiry, and that it matches the payload
 *  the caller expects to be confirming — returns `false` for any mismatch
 *  (tampered args, wrong user, expired, malformed) rather than throwing, so
 *  callers can produce one uniform "no longer valid" chat message. */
export function verifyConfirmationToken(
  token: string,
  expected: ConfirmationPayload,
  secret: string,
): boolean {
  const [bodyBase64, signature] = token.split('.');
  if (!bodyBase64 || !signature) return false;

  const expectedSignature = createHmac('sha256', secret).update(bodyBase64).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  let parsed: ConfirmationPayload & { expiresAt: number };
  try {
    parsed = JSON.parse(Buffer.from(bodyBase64, 'base64url').toString('utf8'));
  } catch {
    return false;
  }

  if (parsed.expiresAt < Date.now()) return false;
  return (
    parsed.userId === expected.userId &&
    parsed.teamId === expected.teamId &&
    parsed.toolName === expected.toolName &&
    parsed.argsJson === expected.argsJson
  );
}
