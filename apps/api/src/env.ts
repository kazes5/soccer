import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).default('postgresql://soccer:soccer@localhost:5432/soccer_dev'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  // Redis is one shared instance across every local environment on a given
  // machine (dev, e2e, and NODE_ENV=test's vitest suite may all point at
  // the same default REDIS_URL while pointing at *different* Postgres
  // databases). apps/api/src/lib/queues.ts's BullMQ key prefix is what
  // keeps their jobs from colliding; this lets a caller pick a prefix
  // explicitly (e.g. the e2e suite uses 'e2e') instead of relying solely on
  // the NODE_ENV-derived default, which only distinguishes 'test' from
  // everything else and isn't enough once two non-test environments (e2e
  // and a developer's own `pnpm dev`) run at once.
  QUEUE_PREFIX: z.string().min(1).optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  SYSTEM_ADMIN_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  PASSWORD_LOGIN_MAX_FAILURES_PER_ACCOUNT_PER_HOUR: z.coerce.number().int().positive().default(10),
  PASSWORD_LOGIN_MAX_FAILURES_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(50),
  INVITE_CODE_MAX_FAILURES_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(50),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  // Unlike login, every /auth/password/forgot request looks identical to the caller
  // regardless of whether the account exists (enumeration resistance) — so there's no
  // "failure" to count. This bounds request *volume* instead, since an unthrottled
  // endpoint could otherwise be used to spam a victim's email/SMS or exhaust the
  // recovery provider's send quota.
  PASSWORD_RESET_MAX_REQUESTS_PER_ACCOUNT_PER_HOUR: z.coerce.number().int().positive().default(5),
  PASSWORD_RESET_MAX_REQUESTS_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(20),
  DEFAULT_PHONE_REGION: z.string().length(2).default('IL'),
  INVITE_TTL_DAYS: z.coerce.number().int().positive().default(7),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  // Set to 'true' only when the API sits behind a reverse proxy that sets X-Forwarded-For,
  // so `request.ip` (used for per-IP rate limiting) reflects the real client, not the proxy.
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
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
  // AI chat (PLAN.md Stage 7): OpenRouter (https://openrouter.ai), an
  // OpenAI-compatible chat-completions API, chosen over calling Anthropic
  // directly per explicit product decision — see CLAUDE.md §6.5. Optional,
  // same graceful-unavailable pattern as VAPID_*: unset means the chat route
  // reports itself unavailable rather than failing hard.
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_MODEL: z.string().min(1).default('google/gemini-2.5-flash'),
  // Signs the short-lived, stateless destructive-action confirmation token
  // (chat-confirmation.ts) — no destructive tool exists yet (CLAUDE.md §6.4
  // only requires shift claim/release/swap so far, none of which need
  // confirmation), but the mechanism ships now, tested, for the admin-action
  // follow-up. Falls back to OPENROUTER_API_KEY in dev/test so the feature
  // works out of the box without a second secret to generate; set explicitly
  // in production.
  CHAT_CONFIRMATION_SECRET: z.string().min(1).optional(),
  CHAT_MAX_REQUESTS_PER_USER_PER_HOUR: z.coerce.number().int().positive().default(30),
  CHAT_MAX_REQUESTS_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(60),
});

export const env = envSchema.parse(process.env);
