import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import type { TranslateJob } from '@subtitle-fm/shared';
import { db } from '../lib/db';
import { advanceEpisodeStatus } from '../lib/episode-status';
import { buildEventId, dispatchToRunpod, getWebhookUrl, isRunpodMode } from '../lib/runpod';
import { log } from '../lib/log';

/**
 * Translate stage: Claude call with episode-level context + per-show
 * glossary. The Python worker runs on RunPod (cheaper to keep all stages
 * on the same endpoint) and POSTs the result to our webhook.
 *
 * Pipeline stops at `ready_for_edit` — `publish` is only triggered by a
 * human action in the editor.
 */
export async function handleTranslate(job: Job<TranslateJob>) {
  const { episodeId, pipelineRunId, transcriptUrl } = job.data;
  log.info({ episodeId, pipelineRunId, transcriptUrl, jobId: job.id }, 'translate.start');

  if (isRunpodMode()) {
    // Wrong-state guard: only dispatch if episode is actually `translating`.
    const [ep] = await db
      .select({ status: schema.episodes.status })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, episodeId))
      .limit(1);
    if (!ep) {
      log.error({ episodeId }, 'translate.episode_not_found');
      return;
    }
    if (ep.status !== 'translating') {
      log.info(
        { episodeId, currentStatus: ep.status },
        'translate.skip.wrong_state',
      );
      return;
    }

    const eventId = buildEventId(episodeId, 'translate', pipelineRunId);
    const result = await dispatchToRunpod({
      episodeId,
      stage: 'translate',
      eventId,
      pipelineRunId,
      webhookUrl: getWebhookUrl(),
      transcriptUrl,
    });
    log.info(
      { episodeId, eventId, runId: result.runId, status: result.status },
      'translate.dispatched',
    );
    return;
  }

  // Stub mode: advance straight to ready_for_edit.
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

  log.warn({ episodeId }, 'translate.stubbed.done');
}
