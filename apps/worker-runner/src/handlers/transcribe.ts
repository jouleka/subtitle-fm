import type { Job } from 'bullmq';
import type { TranscribeJob } from '@subtitle-fm/shared';
import { setEpisodeStatus } from '../lib/episode-status';
import { enqueue } from '../lib/dispatch';
import { log } from '../lib/log';

/**
 * Stub: real handler invokes RunPod serverless with anime-whisper, writes
 * segments to S3, and triggers translate via webhook.
 */
export async function handleTranscribe(job: Job<TranscribeJob>) {
  const { episodeId, audioUrl } = job.data;
  log.info({ episodeId, audioUrl, jobId: job.id }, 'transcribe.start');

  await setEpisodeStatus(episodeId, 'translating');
  await enqueue('translate', { episodeId, transcriptUrl: audioUrl }, episodeId);

  log.warn({ episodeId }, 'transcribe.stubbed.skipped');
}
