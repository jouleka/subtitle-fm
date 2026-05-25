import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import type { TranscribeJob } from '@subtitle-fm/shared';
import { db } from '../lib/db';
import { advanceEpisodeStatus } from '../lib/episode-status';
import { enqueue } from '../lib/dispatch';
import { buildEventId, dispatchToRunpod, getWebhookUrl, isRunpodMode } from '../lib/runpod';
import { log } from '../lib/log';

/**
 * Transcribe stage: faster-whisper + anime-whisper on the preprocessed
 * audio. GPU-bound — dispatched to RunPod when WORKER_MODE=runpod.
 *
 * In runpod mode we don't advance state (the webhook does it on
 * completion); instead we guard against wrong-state dispatch so a retry
 * after a transient dispatch failure doesn't burn GPU on a stale episode.
 */
export async function handleTranscribe(job: Job<TranscribeJob>) {
  const { episodeId, pipelineRunId, audioUrl } = job.data;
  log.info({ episodeId, pipelineRunId, audioUrl, jobId: job.id }, 'transcribe.start');

  if (isRunpodMode()) {
    // Wrong-state guard: only dispatch if episode is actually `transcribing`.
    // Catches BullMQ retries after a successful dispatch + transient failure
    // response, and any stale messages picked up post-completion. The webhook
    // receiver also guards, but only AFTER the GPU spend.
    const [ep] = await db
      .select({ status: schema.episodes.status })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, episodeId))
      .limit(1);
    if (!ep) {
      log.error({ episodeId }, 'transcribe.episode_not_found');
      return; // don't throw — no retry recovers a missing row
    }
    if (ep.status !== 'transcribing') {
      log.info(
        { episodeId, currentStatus: ep.status },
        'transcribe.skip.wrong_state',
      );
      return;
    }

    const eventId = buildEventId(episodeId, 'transcribe', pipelineRunId);
    const result = await dispatchToRunpod({
      episodeId,
      stage: 'transcribe',
      eventId,
      pipelineRunId,
      webhookUrl: getWebhookUrl(),
      audioUrl,
    });
    log.info(
      { episodeId, eventId, runId: result.runId, status: result.status },
      'transcribe.dispatched',
    );
    return;
  }

  // Stub mode: skip the GPU work, advance state, enqueue next stage.
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
  await enqueue('translate', { episodeId, pipelineRunId, transcriptUrl: audioUrl }, episodeId);

  log.warn({ episodeId }, 'transcribe.stubbed.done');
}
