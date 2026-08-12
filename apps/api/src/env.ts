import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).default('postgresql://soccer:soccer@localhost:5432/soccer_dev'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  INVITE_TTL_DAYS: z.coerce.number().int().positive().default(7),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  // Set to 'true' only when the API sits behind a reverse proxy that sets X-Forwarded-For,
  // so `request.ip` (used for per-IP passkey-login rate limiting) reflects the real client,
  // not the proxy.
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // WebAuthn Relying Party identity. `WEBAUTHN_RP_ID` must be the web app's own hostname (no
  // protocol/port) — browsers reject a passkey ceremony if this doesn't match the page origin
  // performing it. Defaults assume local dev against `apps/web` on localhost:3000.
  WEBAUTHN_RP_ID: z.string().min(1).default('localhost'),
  WEBAUTHN_RP_NAME: z.string().min(1).default('Soccer Carpool Coordinator'),
  WEBAUTHN_CHALLENGE_TTL_MINUTES: z.coerce.number().int().positive().default(5),
  // Unlike OTP, a passkey ceremony can't be brute-forced (it needs a real device credential),
  // so this only bounds request volume/enumeration on the unauthenticated login-options
  // endpoint, not a guessable-secret attack.
  WEBAUTHN_LOGIN_MAX_REQUESTS_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(20),
  // VAPID identifies this server to browser push services (no vendor account needed, unlike
  // FCM/APNs — it's a self-generated keypair, `pnpm exec web-push generate-vapid-keys`). All
  // three are optional and travel together: browser push is simply unavailable (the config
  // route reports no public key, and the worker skips push delivery with one log line) when
  // any is unset, so local dev and CI never need real keys just to run the app or test suite.
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  // A contact URI push services may use to reach the sender about this key pair — conventionally
  // `mailto:` per the Web Push protocol (RFC 8292), though an `https://` contact page also works.
  VAPID_SUBJECT: z.string().min(1).optional(),
});

export const env = envSchema.parse(process.env);
