import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).default('postgresql://soccer:soccer@localhost:5432/soccer_dev'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
});

export const env = envSchema.parse(process.env);
