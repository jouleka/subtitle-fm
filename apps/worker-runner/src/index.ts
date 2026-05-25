import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, type JobPayloadByQueue, type QueueName } from '@subtitle-fm/shared';
import { connection } from './lib/connection';
import { closeDispatch } from './lib/dispatch';
import { log } from './lib/log';
import { handlePreprocess } from './handlers/preprocess';
import { handleTranscribe } from './handlers/transcribe';
import { handleTranslate } from './handlers/translate';
import { handlePublish } from './handlers/publish';

const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 2);

/**
 * Stub-mode banner. Default until RunPod is wired and WORKER_MODE flips.
 * Logged at warn so it stands out in any log aggregation.
 */
if (process.env.WORKER_MODE !== 'runpod') {
  log.warn(
    'STUB MODE: preprocess/transcribe/translate handlers fake the pipeline ' +
      'and advance state without real ASR or translation. Episodes will reach ' +
      'ready_for_edit with no actual subtitles.',
  );
}

/**
 * Start a typed BullMQ Worker for one queue. Wired per-queue (rather than
 * looped over QUEUE_NAMES) so TS can narrow Q on each call and reject any
 * handler/payload mismatch at the call site.
 */
function startWorker<Q extends QueueName>(
  name: Q,
  handler: (job: Job<JobPayloadByQueue[Q]>) => Promise<void>,
): Worker<JobPayloadByQueue[Q]> {
  const worker = new Worker<JobPayloadByQueue[Q]>(name, handler, { connection, concurrency });
  worker.on('completed', (job) => log.info({ queue: name, jobId: job.id }, 'job.completed'));
  worker.on('failed', (job, err) =>
    log.error({ queue: name, jobId: job?.id, err: err?.message ?? 'unknown' }, 'job.failed'),
  );
  worker.on('error', (err) => log.error({ queue: name, err: err.message }, 'worker.error'));
  log.info({ queue: name, concurrency }, 'worker.listening');
  return worker;
}

const workers: Worker[] = [
  startWorker(QUEUE_NAMES.preprocess, handlePreprocess),
  startWorker(QUEUE_NAMES.transcribe, handleTranscribe),
  startWorker(QUEUE_NAMES.translate, handleTranslate),
  startWorker(QUEUE_NAMES.publish, handlePublish),
];

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) {
    log.info({ signal }, 'worker.shutdown.already_in_progress');
    return;
  }
  shuttingDown = true;
  log.info({ signal }, 'worker.shutdown.start');
  // Order matters: workers stop consuming, then dispatch queues release
  // their blocking-command clients, then the shared connection quits.
  await Promise.all(workers.map((w) => w.close()));
  await closeDispatch();
  await connection.quit();
  log.info('worker.shutdown.done');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
