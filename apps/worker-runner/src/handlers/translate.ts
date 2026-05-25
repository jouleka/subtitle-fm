import type { Job } from 'bullmq';
import type { TranslateJob } from '@subtitle-fm/shared';
import { setEpisodeStatus } from '../lib/episode-status';
import { log } from '../lib/log';

/**
 * Stub: real handler calls Claude with episode-level context + show glossary,
 * writes structured translation, and transitions to `ready_for_edit`.
 *
 * Pipeline stops here. `publish` is only triggered by human action in the
 * editor, not auto-enqueued.
 */
export async function handleTranslate(job: Job<TranslateJob>) {
  const { episodeId, transcriptUrl } = job.data;
  log.info({ episodeId, transcriptUrl, jobId: job.id }, 'translate.start');

  await setEpisodeStatus(episodeId, 'ready_for_edit');

  log.warn({ episodeId }, 'translate.stubbed.skipped');
}
