import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

/**
 * Single shared Redis connection for all BullMQ Workers in this process.
 * BullMQ requires `maxRetriesPerRequest: null` for blocking commands.
 */
export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});
