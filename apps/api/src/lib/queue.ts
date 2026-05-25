import { Queue } from 'bullmq';
import IORedis from 'ioredis';

/**
 * Queue topology:
 *
 * preprocess  → fan-out: fetch source, trim OP/ED, isolate vocals, generate peaks
 * transcribe  → invoke RunPod serverless with anime-whisper, return segments
 * translate   → Claude translation pass with show glossary
 * publish     → emit .ass / .srt / .vtt, mark episode published
 *
 * Producers live in the api; consumers live in a separate `apps/worker-runner`
 * Node service (not yet scaffolded) that dispatches to RunPod.
 */

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

export const preprocessQueue = new Queue('preprocess', { connection });
export const transcribeQueue = new Queue('transcribe', { connection });
export const translateQueue = new Queue('translate', { connection });
export const publishQueue = new Queue('publish', { connection });

export interface PreprocessJob {
  episodeId: string;
  sourceUrl: string;
}
