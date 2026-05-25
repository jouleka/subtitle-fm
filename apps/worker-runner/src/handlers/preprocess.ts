import type { Job } from 'bullmq';
import type { PreprocessJob } from '@subtitle-fm/shared';
import { setEpisodeStatus } from '../lib/episode-status';
import { enqueue } from '../lib/dispatch';
import { log } from '../lib/log';

/**
 * Stub implementation. In production this dispatches to RunPod serverless
 * (audio extract + OP/ED trim + Demucs vocal isolation + peaks generation),
 * which posts results back via webhook. The webhook handler advances state
 * and enqueues `transcribe`.
 *
 * In stub mode we simulate the dispatch + completion synchronously so the
 * pipeline progresses locally without GPU access.
 */
export async function handlePreprocess(job: Job<PreprocessJob>) {
  const { episodeId, sourceUrl } = job.data;
  log.info({ episodeId, sourceUrl, jobId: job.id }, 'preprocess.start');

  await setEpisodeStatus(episodeId, 'preprocessing');

  // TODO(runpod): dispatch real preprocess job. For now hand off straight
  // to transcribe with a placeholder audioUrl so the local pipeline flows.
  await setEpisodeStatus(episodeId, 'transcribing');
  await enqueue('transcribe', { episodeId, audioUrl: sourceUrl }, episodeId);

  log.warn({ episodeId }, 'preprocess.stubbed.skipped');
}
