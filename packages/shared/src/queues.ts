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
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface PreprocessJob {
  episodeId: string;
  sourceUrl: string;
}

export interface TranscribeJob {
  episodeId: string;
  audioUrl: string;
}

export interface TranslateJob {
  episodeId: string;
  transcriptUrl: string;
}

export interface PublishJob {
  episodeId: string;
  formats: ReadonlyArray<'ass' | 'srt' | 'vtt'>;
}

export type JobPayloadByQueue = {
  preprocess: PreprocessJob;
  transcribe: TranscribeJob;
  translate: TranslateJob;
  publish: PublishJob;
};
