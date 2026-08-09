import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).default('postgresql://soccer:soccer@localhost:5432/soccer_dev'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  OTP_MAX_REQUESTS_PER_HOUR: z.coerce.number().int().positive().default(3),
  OTP_MAX_REQUESTS_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(10),
  OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().positive().default(5),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  INVITE_TTL_DAYS: z.coerce.number().int().positive().default(7),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  // Set to 'true' only when the API sits behind a reverse proxy that sets X-Forwarded-For,
  // so `request.ip` (used for per-IP OTP rate limiting) reflects the real client, not the proxy.
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export const env = envSchema.parse(process.env);
