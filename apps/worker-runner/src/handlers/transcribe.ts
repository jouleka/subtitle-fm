import type { Job } from 'bullmq';
import type { TranscribeJob } from '@subtitle-fm/shared';
import { db } from '../lib/db';
import { advanceEpisodeStatus } from '../lib/episode-status';
import { enqueue } from '../lib/dispatch';
import { log } from '../lib/log';

/**
 * Stub: real handler invokes RunPod serverless with anime-whisper, writes
 * segments to R2, and triggers translate via the webhook receiver.
 */
export async function handleTranscribe(job: Job<TranscribeJob>) {
  const { episodeId, audioUrl } = job.data;
  log.info({ episodeId, audioUrl, jobId: job.id }, 'transcribe.start');

  const result = await advanceEpisodeStatus(db, episodeId, {
    from: ['transcribing'],
    to: 'translating',
  });
  if (!result.advanced) {
    log.info(
      { episodeId, currentStatus: result.currentStatus },
      'transcribe.skip.already_advanced',
    );
    return;
  }
  await enqueue('translate', { episodeId, transcriptUrl: audioUrl }, episodeId);

  log.warn({ episodeId }, 'transcribe.stubbed.skipped');
}
