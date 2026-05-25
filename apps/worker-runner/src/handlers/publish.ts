import type { Job } from 'bullmq';
import type { PublishJob } from '@subtitle-fm/shared';
import { db } from '../lib/db';
import { advanceEpisodeStatus } from '../lib/episode-status';
import { log } from '../lib/log';

/**
 * Stub: real handler renders final cues to .ass/.srt/.vtt, uploads to R2,
 * notifies Stremio addon cache, and marks the episode published.
 *
 * Accepts ready_for_edit OR in_review as predecessor states — publish is
 * the only transition driven by an explicit human action.
 */
export async function handlePublish(job: Job<PublishJob>) {
  const { episodeId, pipelineRunId, formats } = job.data;
  log.info({ episodeId, pipelineRunId, formats, jobId: job.id }, 'publish.start');

  const result = await advanceEpisodeStatus(db, episodeId, {
    from: ['ready_for_edit', 'in_review'],
    to: 'published',
  });
  if (!result.advanced) {
    log.info(
      { episodeId, currentStatus: result.currentStatus },
      'publish.skip.already_advanced',
    );
    return;
  }

  log.info({ episodeId }, 'publish.done');
}
