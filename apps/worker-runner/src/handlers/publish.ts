import type { Job } from 'bullmq';
import type { PublishJob } from '@subtitle-fm/shared';
import { setEpisodeStatus } from '../lib/episode-status';
import { log } from '../lib/log';

/**
 * Stub: real handler renders final cues to .ass/.srt/.vtt, uploads to R2,
 * notifies Stremio addon cache, and marks the episode published.
 */
export async function handlePublish(job: Job<PublishJob>) {
  const { episodeId, formats } = job.data;
  log.info({ episodeId, formats, jobId: job.id }, 'publish.start');

  await setEpisodeStatus(episodeId, 'published');

  log.info({ episodeId }, 'publish.done');
}
