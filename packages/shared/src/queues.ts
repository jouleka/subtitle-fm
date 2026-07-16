/**
 * Queue names + job payload types shared between the API (producer) and
 * worker-runner (consumer). Keep this file dependency-free — it is imported
 * by every app that touches the job pipeline.
 */

export const QUEUE_NAMES = {
  preprocess: 'preprocess',
  transcribe: 'transcribe',
  translate: 'translate',
  publish: 'publish',
  cleanupMedia: 'cleanup-media',
} as const;

/**
 * BullMQ job options applied to every queue add() in the system. Lives here
 * so api + worker-runner can't drift — one source of truth for retry
 * behaviour, retention, and backoff.
 *
 * Spread with `jobId`:
 *   queue.add(name, payload, { jobId: episodeId, ...JOB_OPTS_DEFAULT })
 */
export const JOB_OPTS_DEFAULT = {
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 1000 },
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Minted once per pipeline pass (POST /episodes creates one; manual reprocess
 * mints a fresh one). Threads through every stage so the webhook receiver's
 * idempotency PK is unique-per-pass — without it, a reprocess collides with
 * the original pass's eventId and the webhook is silently dropped.
 */
export type PipelineRunId = string;

export interface PreprocessJob {
  episodeId: string;
  pipelineRunId: PipelineRunId;
  sourceUrl: string;
}

export interface TranscribeJob {
  episodeId: string;
  pipelineRunId: PipelineRunId;
  audioUrl: string;
}

export interface TranslateJob {
  episodeId: string;
  pipelineRunId: PipelineRunId;
  transcriptUrl: string;
}

export interface PublishJob {
  episodeId: string;
  pipelineRunId: PipelineRunId;
  /** Immutable snapshot captured by the API at the publish gate. */
  snapshotId: string;
  formats: ReadonlyArray<'ass' | 'srt' | 'vtt'>;
}

export interface CleanupMediaJob {
  episodeId: string;
  objects: ReadonlyArray<{
    bucket: 'media' | 'peaks';
    key: string;
  }>;
}

export type JobPayloadByQueue = {
  preprocess: PreprocessJob;
  transcribe: TranscribeJob;
  translate: TranslateJob;
  publish: PublishJob;
  'cleanup-media': CleanupMediaJob;
};
