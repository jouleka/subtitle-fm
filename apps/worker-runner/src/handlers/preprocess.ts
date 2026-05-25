import type { Job } from 'bullmq';
import type { PreprocessJob } from '@subtitle-fm/shared';
import { db } from '../lib/db';
import { advanceEpisodeStatus } from '../lib/episode-status';
import { enqueue } from '../lib/dispatch';
import { log } from '../lib/log';

/**
 * Stub implementation. In production this dispatches to RunPod serverless
 * (audio extract + OP/ED trim + Demucs vocal isolation + peaks generation);
 * RunPod posts results back to /webhooks/runpod, which advances state and
 * enqueues `transcribe`.
 *
 * In stub mode we simulate the dispatch + completion synchronously so the
 * pipeline progresses locally without GPU access.
 *
 * Idempotency: state transitions are forward-only via advanceEpisodeStatus.
 * A retry against an already-advanced episode logs and skips downstream
 * work rather than rewinding state.
 */
export async function handlePreprocess(job: Job<PreprocessJob>) {
  const { episodeId, sourceUrl } = job.data;
  log.info({ episodeId, sourceUrl, jobId: job.id }, 'preprocess.start');

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

  // TODO(runpod): real handler dispatches the RunPod job here and returns;
  // the webhook receiver advances to 'transcribing' and enqueues the next
  // stage. The stub does both steps inline so the pipeline visibly flows.
  //
  // Defensive: in mixed environments where stub mode runs alongside a real
  // RunPod webhook (rare but possible during cutover), the webhook could
  // race this handler and advance state between the two calls. Treat that
  // as a hand-off, not a bug — log and exit.
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
  await enqueue('transcribe', { episodeId, audioUrl: sourceUrl }, episodeId);

  log.warn({ episodeId }, 'preprocess.stubbed.skipped');
}
