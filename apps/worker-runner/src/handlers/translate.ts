import type { Job } from 'bullmq';
import type { TranslateJob } from '@subtitle-fm/shared';
import { db } from '../lib/db';
import { advanceEpisodeStatus } from '../lib/episode-status';
import { log } from '../lib/log';

/**
 * Stub: real handler calls Claude with episode-level context + show
 * glossary, writes structured translation, and transitions to
 * `ready_for_edit`. Pipeline stops here — `publish` is only triggered by
 * human action in the editor, not auto-enqueued.
 */
export async function handleTranslate(job: Job<TranslateJob>) {
  const { episodeId, transcriptUrl } = job.data;
  log.info({ episodeId, transcriptUrl, jobId: job.id }, 'translate.start');

  const result = await advanceEpisodeStatus(db, episodeId, {
    from: ['translating'],
    to: 'ready_for_edit',
  });
  if (!result.advanced) {
    log.info(
      { episodeId, currentStatus: result.currentStatus },
      'translate.skip.already_advanced',
    );
    return;
  }

  log.warn({ episodeId }, 'translate.stubbed.skipped');
}
