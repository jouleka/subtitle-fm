import type { Job } from 'bullmq';
import type { CleanupMediaJob } from '@subtitle-fm/shared';
import { deleteObject } from '../lib/r2';
import { log } from '../lib/log';

/** Delete ephemeral pipeline objects after the post-publish grace period. */
export async function handleCleanupMedia(job: Job<CleanupMediaJob>) {
  const { episodeId, objects } = job.data;
  log.info({ episodeId, objects: objects.length, jobId: job.id }, 'cleanup_media.start');

  // R2/S3 deletes are idempotent, so a partial failure is safe to retry.
  await Promise.all(objects.map((object) => deleteObject(object.bucket, object.key)));

  log.info({ episodeId, objects: objects.length }, 'cleanup_media.done');
}
