import type { Job } from 'bullmq';
import type { PreprocessJob } from '@subtitle-fm/shared';
import { db } from '../lib/db';
import { advanceEpisodeStatus } from '../lib/episode-status';
import { enqueue } from '../lib/dispatch';
import { buildEventId, dispatchToRunpod, getWebhookUrl, isRunpodMode } from '../lib/runpod';
import { log } from '../lib/log';

/**
 * Preprocess stage: extract audio, trim OP/ED, isolate vocals, generate
 * waveform peaks. GPU-bound — runs on RunPod when WORKER_MODE=runpod.
 *
 * In runpod mode we advance `uploaded → preprocessing`, dispatch the job
 * to RunPod with a webhook URL pointing at our /webhooks/runpod, and
 * return. The Python worker POSTs the completion (HMAC-signed with its
 * own env-resident secret) which advances state to `transcribing` and
 * enqueues the next stage.
 *
 * In stub mode we synthesize the entire flow inline so the local pipeline
 * progresses visibly without GPU access.
 */
export async function handlePreprocess(job: Job<PreprocessJob>) {
  const { episodeId, pipelineRunId, sourceUrl } = job.data;
  log.info({ episodeId, pipelineRunId, sourceUrl, jobId: job.id }, 'preprocess.start');

  const start = await advanceEpisodeStatus(db, episodeId, {
    from: ['uploaded'],
    to: 'preprocessing',
  });
  if (!start.advanced) {
    log.info(
      { episodeId, currentStatus: start.currentStatus },
      'preprocess.skip.already_advanced',
    );
    return;
  }

  if (isRunpodMode()) {
    const eventId = buildEventId(episodeId, 'preprocess', pipelineRunId);
    // TODO(sweeper): persist runId on the episode so a future watchdog can
    // poll RunPod /status for jobs whose webhook never arrived.
    const result = await dispatchToRunpod({
      episodeId,
      stage: 'preprocess',
      eventId,
      pipelineRunId,
      webhookUrl: getWebhookUrl(),
      sourceUrl,
    });
    log.info(
      { episodeId, eventId, runId: result.runId, status: result.status },
      'preprocess.dispatched',
    );
    return;
  }

  // Stub mode fall-through: simulate the webhook callback inline. Defensive
  // hand-off check covers the unlikely race where webhook + stub coexist.
  const handoff = await advanceEpisodeStatus(db, episodeId, {
    from: ['preprocessing'],
    to: 'transcribing',
  });
  if (!handoff.advanced) {
    log.warn(
      { episodeId, currentStatus: handoff.currentStatus },
      'preprocess.handoff.race_with_webhook',
    );
    return;
  }
  await enqueue('transcribe', { episodeId, pipelineRunId, audioUrl: sourceUrl }, episodeId);

  log.warn({ episodeId }, 'preprocess.stubbed.done');
}
