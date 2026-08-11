import IORedis from 'ioredis';
import { env } from '../env';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on its Redis connections —
 * without it, ioredis gives up retrying a blocking command (which BullMQ's
 * Worker relies on to wait for jobs) after a fixed number of attempts,
 * silently breaking job consumption. Each caller gets its own connection
 * (BullMQ's Queue/Worker/QueueEvents each want a dedicated one), so this is
 * a factory, not a shared singleton.
 */
export function createRedisConnection(): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
