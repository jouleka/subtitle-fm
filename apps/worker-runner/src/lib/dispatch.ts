import { Queue } from 'bullmq';
import {
  QUEUE_NAMES,
  type JobPayloadByQueue,
  type QueueName,
} from '@subtitle-fm/shared';
import { connection } from './connection';

/**
 * Producer-side queue handles used by handlers when they hand off work to
 * the next pipeline stage. Kept here (rather than re-importing the api's
 * lib/queue) so the worker-runner has no dependency on the api package.
 */
const queues = {
  [QUEUE_NAMES.preprocess]: new Queue<JobPayloadByQueue['preprocess']>(QUEUE_NAMES.preprocess, {
    connection,
  }),
  [QUEUE_NAMES.transcribe]: new Queue<JobPayloadByQueue['transcribe']>(QUEUE_NAMES.transcribe, {
    connection,
  }),
  [QUEUE_NAMES.translate]: new Queue<JobPayloadByQueue['translate']>(QUEUE_NAMES.translate, {
    connection,
  }),
  [QUEUE_NAMES.publish]: new Queue<JobPayloadByQueue['publish']>(QUEUE_NAMES.publish, {
    connection,
  }),
} as const;

export async function enqueue<Q extends QueueName>(
  name: Q,
  payload: JobPayloadByQueue[Q],
  jobId?: string,
): Promise<void> {
  // We've already enforced (name, payload) pairing via the Q generic at the
  // function boundary. BullMQ's per-queue name-typing is messy through
  // indexed access, so loosen to Queue<unknown> just for the .add call.
  const queue = queues[name] as unknown as Queue<unknown>;
  await queue.add(name, payload, {
    jobId,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 1000 },
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
  });
}

/**
 * Close every dispatch queue. Must run before `connection.quit()` so the
 * blocking-command clients each queue holds get released cleanly.
 */
export async function closeDispatch(): Promise<void> {
  await Promise.all(Object.values(queues).map((q) => q.close()));
}
