import type { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import type { PublishJob } from '@subtitle-fm/shared';
import { publishedSubtitleKeys, temporaryMediaObjects } from '@subtitle-fm/shared';
import { liveCuesFromSnapshot } from '@subtitle-fm/shared/yjs';
import { defaultParsedAss, serializeAss, toSrt, toVtt } from '@subtitle-fm/ass';
import { db } from '../lib/db';
import { advanceEpisodeStatus } from '../lib/episode-status';
import { enqueue } from '../lib/dispatch';
import { log } from '../lib/log';
import { putObject } from '../lib/r2';

const MEDIA_DELETE_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * Render the immutable snapshot selected by the API, upload all requested
 * formats, schedule ephemeral-media deletion, then expose the artifacts by
 * making the final publishing -> published transition.
 */
export async function handlePublish(job: Job<PublishJob>) {
  const { episodeId, pipelineRunId, snapshotId, formats } = job.data;
  log.info({ episodeId, pipelineRunId, formats, jobId: job.id }, 'publish.start');

  try {
    const [episode] = await db
      .select({ status: schema.episodes.status, sourceKey: schema.episodes.sourceKey })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, episodeId))
      .limit(1);
    if (!episode) throw new Error(`episode ${episodeId} not found`);
    if (episode.status === 'published') {
      log.info({ episodeId }, 'publish.skip.already_published');
      return;
    }
    if (episode.status !== 'publishing') {
      throw new Error(`episode ${episodeId} is ${episode.status}, expected publishing`);
    }

    const [snapshot] = await db
      .select({ yjsState: schema.snapshots.yjsState })
      .from(schema.snapshots)
      .where(and(eq(schema.snapshots.id, snapshotId), eq(schema.snapshots.episodeId, episodeId)))
      .limit(1);
    if (!snapshot) throw new Error(`publish snapshot ${snapshotId} not found`);

    const cues = liveCuesFromSnapshot(snapshot.yjsState);
    if (cues.length === 0) throw new Error('publish snapshot has no cues');
    const unreviewed = cues.filter((cue) => cue.needsReview).length;
    if (unreviewed > 0) throw new Error(`publish snapshot has ${unreviewed} unreviewed cues`);

    const parsed = defaultParsedAss(cues);
    const rendered = {
      ass: { body: serializeAss(parsed), contentType: 'text/plain; charset=utf-8' },
      srt: { body: toSrt(parsed), contentType: 'application/x-subrip; charset=utf-8' },
      vtt: { body: toVtt(parsed), contentType: 'text/vtt; charset=utf-8' },
    } as const;
    const keys = publishedSubtitleKeys(episodeId);

    // Canonical keys make retries safe: a partial upload is overwritten before
    // the episode becomes visible as published.
    for (const format of formats) {
      await putObject('media', keys[format], rendered[format].body, rendered[format].contentType);
    }

    await enqueue(
      'cleanup-media',
      { episodeId, objects: temporaryMediaObjects(episodeId, episode.sourceKey) },
      `cleanup-${snapshotId}`,
      MEDIA_DELETE_DELAY_MS,
    );

    const result = await advanceEpisodeStatus(db, episodeId, {
      from: ['publishing'],
      to: 'published',
    });
    if (!result.advanced && result.currentStatus !== 'published') {
      throw new Error(`publish transition refused from ${result.currentStatus}`);
    }

    log.info({ episodeId, snapshotId, formats }, 'publish.done');
  } catch (error) {
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade + 1 >= maxAttempts) {
      const failed = await advanceEpisodeStatus(db, episodeId, {
        from: ['publishing'],
        to: 'failed',
      });
      log.error(
        {
          episodeId,
          snapshotId,
          err: String(error),
          finalAttempt: true,
          currentStatus: failed.advanced ? 'failed' : failed.currentStatus,
        },
        'publish.failed',
      );
    }
    throw error;
  }
}
