import { Hono } from 'hono';
import { z } from 'zod';
import { schema, advanceEpisodeStatus, failEpisode } from '@subtitle-fm/db';
import { JOB_OPTS_DEFAULT, type JobPayloadByQueue } from '@subtitle-fm/shared';
import { db } from '../lib/db';
import { verifyHmacSha256 } from '../lib/hmac';
import { transcribeQueue, translateQueue } from '../lib/queue';
import { log } from '../lib/log';

const SIGNATURE_HEADER = 'X-Signature-256';

const stageEnum = z.enum(['preprocess', 'transcribe', 'translate', 'publish']);

const baseFields = {
  eventId: z.string().min(1).max(255),
  episodeId: z.string().uuid(),
};

/**
 * Per-stage discriminated completion schemas. Each stage that produces an
 * artifact REQUIRES the matching output key — RunPod completing without it
 * is a contract violation by the dispatcher, not a recoverable condition
 * (Rule 12: fail loud). Translate/publish have no artifact handoff.
 */
const preprocessCompleted = z.object({
  ...baseFields,
  status: z.literal('completed'),
  stage: z.literal('preprocess'),
  output: z.object({ audioKey: z.string().min(1) }),
});
const transcribeCompleted = z.object({
  ...baseFields,
  status: z.literal('completed'),
  stage: z.literal('transcribe'),
  output: z.object({ transcriptKey: z.string().min(1) }),
});
const translateCompleted = z.object({
  ...baseFields,
  status: z.literal('completed'),
  stage: z.literal('translate'),
});
const publishCompleted = z.object({
  ...baseFields,
  status: z.literal('completed'),
  stage: z.literal('publish'),
});
const failed = z.object({
  ...baseFields,
  status: z.literal('failed'),
  stage: stageEnum,
  error: z.string().optional(),
});

const payloadSchema = z.union([
  preprocessCompleted,
  transcribeCompleted,
  translateCompleted,
  publishCompleted,
  failed,
]);

export const webhooksRunpod = new Hono().post('/', async (c) => {
  const secret = process.env.WORKER_WEBHOOK_SECRET;
  if (!secret) {
    log.error('webhook.runpod.unconfigured');
    return c.json({ error: 'webhook_not_configured' }, 503);
  }

  // Read raw body BEFORE parsing — HMAC is computed on bytes as received,
  // not on a re-serialized JSON.
  const raw = await c.req.text();
  const sig = c.req.header(SIGNATURE_HEADER) ?? '';
  if (!verifyHmacSha256(raw, sig, secret)) {
    log.warn(
      { ip: c.req.header('X-Forwarded-For'), bytes: raw.length },
      'webhook.runpod.bad_signature',
    );
    return c.json({ error: 'bad_signature' }, 401);
  }

  let parsed;
  try {
    parsed = payloadSchema.parse(JSON.parse(raw));
  } catch (e) {
    log.warn(
      {
        err: (e as Error).message,
        ip: c.req.header('X-Forwarded-For'),
        contentType: c.req.header('Content-Type'),
        bytes: raw.length,
      },
      'webhook.runpod.bad_payload',
    );
    return c.json({ error: 'bad_payload' }, 400);
  }

  // Idempotency: PK insert + ON CONFLICT DO NOTHING. If the row already
  // exists, we've seen this event — return 200 so the upstream stops
  // retrying, but skip the state mutation.
  const inserted = await db
    .insert(schema.webhookEvents)
    .values({
      id: parsed.eventId,
      source: 'runpod',
      episodeId: parsed.episodeId,
      stage: parsed.stage,
      status: parsed.status,
      payload: parsed,
    })
    .onConflictDoNothing({ target: schema.webhookEvents.id })
    .returning({ id: schema.webhookEvents.id });

  if (inserted.length === 0) {
    log.info({ eventId: parsed.eventId }, 'webhook.runpod.duplicate.skipped');
    return c.json({ status: 'ok', duplicate: true });
  }

  if (parsed.status === 'failed') {
    const r = await failEpisode(db, parsed.episodeId);
    if (r.advanced) {
      log.error(
        { episodeId: parsed.episodeId, stage: parsed.stage, error: parsed.error },
        'webhook.runpod.stage_failed',
      );
    } else {
      // failure arrived after the episode reached a terminal state — log
      // and no-op (the forward-only guard correctly refused to rewind).
      log.warn(
        { episodeId: parsed.episodeId, currentStatus: r.currentStatus, stage: parsed.stage },
        'webhook.runpod.failure_after_terminal',
      );
    }
    return c.json({ status: 'ok' });
  }

  // status === 'completed' — Zod narrows `parsed` to per-stage shape.
  if (parsed.stage === 'preprocess') {
    const result = await advanceEpisodeStatus(db, parsed.episodeId, {
      from: ['preprocessing'],
      to: 'transcribing',
    });
    if (!result.advanced) {
      log.info(
        { episodeId: parsed.episodeId, currentStatus: result.currentStatus },
        'webhook.runpod.preprocess.skip.already_advanced',
      );
      return c.json({ status: 'ok', skipped: true });
    }
    const next: JobPayloadByQueue['transcribe'] = {
      episodeId: parsed.episodeId,
      audioUrl: parsed.output.audioKey,
    };
    await transcribeQueue.add('transcribe', next, {
      jobId: parsed.episodeId,
      ...JOB_OPTS_DEFAULT,
    });
    return c.json({ status: 'ok', enqueued: 'transcribe' });
  }

  if (parsed.stage === 'transcribe') {
    const result = await advanceEpisodeStatus(db, parsed.episodeId, {
      from: ['transcribing'],
      to: 'translating',
    });
    if (!result.advanced) {
      log.info(
        { episodeId: parsed.episodeId, currentStatus: result.currentStatus },
        'webhook.runpod.transcribe.skip.already_advanced',
      );
      return c.json({ status: 'ok', skipped: true });
    }
    const next: JobPayloadByQueue['translate'] = {
      episodeId: parsed.episodeId,
      transcriptUrl: parsed.output.transcriptKey,
    };
    await translateQueue.add('translate', next, {
      jobId: parsed.episodeId,
      ...JOB_OPTS_DEFAULT,
    });
    return c.json({ status: 'ok', enqueued: 'translate' });
  }

  if (parsed.stage === 'translate') {
    const result = await advanceEpisodeStatus(db, parsed.episodeId, {
      from: ['translating'],
      to: 'ready_for_edit',
    });
    if (!result.advanced) {
      log.info(
        { episodeId: parsed.episodeId, currentStatus: result.currentStatus },
        'webhook.runpod.translate.skip.already_advanced',
      );
      return c.json({ status: 'ok', skipped: true });
    }
    return c.json({ status: 'ok' });
  }

  // stage === 'publish'
  const result = await advanceEpisodeStatus(db, parsed.episodeId, {
    from: ['ready_for_edit', 'in_review'],
    to: 'published',
  });
  if (!result.advanced) {
    log.info(
      { episodeId: parsed.episodeId, currentStatus: result.currentStatus },
      'webhook.runpod.publish.skip.already_advanced',
    );
    return c.json({ status: 'ok', skipped: true });
  }
  return c.json({ status: 'ok' });
});
