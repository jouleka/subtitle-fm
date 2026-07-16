import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUE_NAMES, type JobPayloadByQueue } from '@subtitle-fm/shared';

/**
 * Producer-side queue instances. Consumers live in apps/worker-runner.
 * Queue names + job payload types are defined in @subtitle-fm/shared
 * so both ends stay aligned.
 */

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

export const preprocessQueue = new Queue<JobPayloadByQueue['preprocess']>(QUEUE_NAMES.preprocess, {
  connection,
});
export const transcribeQueue = new Queue<JobPayloadByQueue['transcribe']>(QUEUE_NAMES.transcribe, {
  connection,
});
export const translateQueue = new Queue<JobPayloadByQueue['translate']>(QUEUE_NAMES.translate, {
  connection,
});
export const publishQueue = new Queue<JobPayloadByQueue['publish']>(QUEUE_NAMES.publish, {
  connection,
});
export const cleanupMediaQueue = new Queue<JobPayloadByQueue['cleanup-media']>(
  QUEUE_NAMES.cleanupMedia,
  { connection },
);
