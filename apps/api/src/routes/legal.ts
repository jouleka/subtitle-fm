import { Hono, type Context, type Next } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@subtitle-fm/db';
import {
  JOB_OPTS_DEFAULT,
  publishedSubtitleKeys,
  type CleanupMediaJob,
  type PublishJob,
} from '@subtitle-fm/shared';
import { db } from '../lib/db';
import { log } from '../lib/log';
import * as queues from '../lib/queue';
import { requireSession, type AuthVariables } from '../lib/session';

const boundedText = (min: number, max: number) => z.string().trim().min(min).max(max);
const signature = boundedText(2, 200);
const phone = boundedText(5, 80);
const address = boundedText(10, 1000);

const noticeSchema = z.object({
  claimantName: boundedText(2, 200),
  claimantEmail: z.string().trim().email().max(320),
  claimantAddress: address,
  claimantPhone: phone,
  copyrightedWork: boundedText(10, 5000),
  materialUrl: z.string().trim().url().max(2000),
  signature,
  goodFaithConfirmed: z.literal(true),
  accuracyConfirmed: z.literal(true),
});

const counterNoticeSchema = z.object({
  submitterName: boundedText(2, 200),
  submitterEmail: z.string().trim().email().max(320),
  submitterAddress: address,
  submitterPhone: phone,
  removedMaterialUrl: z.string().trim().url().max(2000),
  signature,
  mistakeConfirmed: z.literal(true),
  jurisdictionConfirmed: z.literal(true),
  serviceConfirmed: z.literal(true),
});

const reviewSchema = z.object({
  action: z.enum(['begin_review', 'remove', 'reject', 'court_action', 'restore']),
  notes: z.string().trim().max(5000).optional(),
});

function episodeIdFromMaterialUrl(materialUrl: string): string | null {
  const pathname = new URL(materialUrl).pathname;
  return (
    pathname.match(
      /\/episodes\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/|$)/i,
    )?.[1] ?? null
  );
}

export function addBusinessDays(input: Date, count: number): Date {
  const result = new Date(input);
  let remaining = count;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

async function requireAdmin(c: Context<{ Variables: AuthVariables }>, next: Next) {
  const userId = c.get('user')!.id;
  const [user] = await db
    .select({ role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (user?.role !== 'admin') return c.json({ error: 'admin_required' }, 403);
  await next();
}

type LegalJobOptions = typeof JOB_OPTS_DEFAULT & { jobId: string };
type LegalQueueProducer<T> = {
  add(name: string, data: T, options: LegalJobOptions): Promise<unknown>;
};
type LegalQueueDependencies = {
  cleanupMediaQueue: LegalQueueProducer<CleanupMediaJob>;
  publishQueue: LegalQueueProducer<PublishJob>;
};

async function enqueueRemoval(
  episodeId: string,
  noticeId: string,
  cleanupQueue: LegalQueueDependencies['cleanupMediaQueue'],
) {
  const keys = publishedSubtitleKeys(episodeId);
  const job: CleanupMediaJob = {
    episodeId,
    objects: Object.values(keys).map((key) => ({ bucket: 'media' as const, key })),
  };
  await cleanupQueue.add('dmca-remove', job, {
    jobId: `dmca-remove-${noticeId}`,
    ...JOB_OPTS_DEFAULT,
  });
}

export function createLegalRoutes(dependencies?: LegalQueueDependencies) {
  const legalQueues = dependencies ?? queues;
  return new Hono<{ Variables: AuthVariables }>()
  .post('/takedowns', zValidator('json', noticeSchema), async (c) => {
    const input = c.req.valid('json');
    const episodeId = episodeIdFromMaterialUrl(input.materialUrl);
    if (!episodeId) return c.json({ error: 'material_url_must_identify_episode' }, 400);

    const [episode] = await db
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, episodeId))
      .limit(1);
    if (!episode) return c.json({ error: 'material_not_found' }, 404);

    const [notice] = await db
      .insert(schema.takedownNotices)
      .values({ ...input, episodeId })
      .returning({
        id: schema.takedownNotices.id,
        status: schema.takedownNotices.status,
        createdAt: schema.takedownNotices.createdAt,
      });
    log.info({ noticeId: notice!.id, episodeId }, 'takedown.submitted');
    return c.json({ notice }, 202);
  })
  .post('/takedowns/:id/counter-notice', zValidator('json', counterNoticeSchema), async (c) => {
    const noticeId = c.req.param('id');
    const input = c.req.valid('json');
    const [notice] = await db
      .select({ id: schema.takedownNotices.id, status: schema.takedownNotices.status })
      .from(schema.takedownNotices)
      .where(eq(schema.takedownNotices.id, noticeId))
      .limit(1);
    if (!notice) return c.json({ error: 'notice_not_found' }, 404);
    if (notice.status !== 'removed') {
      return c.json({ error: 'counter_notice_not_available', status: notice.status }, 409);
    }
    const [existing] = await db
      .select({ id: schema.counterNotices.id })
      .from(schema.counterNotices)
      .where(eq(schema.counterNotices.takedownNoticeId, noticeId))
      .limit(1);
    if (existing) return c.json({ error: 'counter_notice_already_submitted' }, 409);

    const submittedAt = new Date();
    const restoreEligibleAt = addBusinessDays(submittedAt, 10);
    const restoreDeadlineAt = addBusinessDays(submittedAt, 14);
      const counter = await db.transaction(async (tx) => {
        const [transitioned] = await tx
          .update(schema.takedownNotices)
          .set({ status: 'counter_submitted', updatedAt: submittedAt })
          .where(
            and(
              eq(schema.takedownNotices.id, noticeId),
              eq(schema.takedownNotices.status, 'removed'),
            ),
          )
          .returning({ id: schema.takedownNotices.id });
        if (!transitioned) return null;
        const [created] = await tx
        .insert(schema.counterNotices)
        .values({
          ...input,
          takedownNoticeId: noticeId,
          restoreEligibleAt,
          restoreDeadlineAt,
        })
        .returning({
          id: schema.counterNotices.id,
          restoreEligibleAt: schema.counterNotices.restoreEligibleAt,
          restoreDeadlineAt: schema.counterNotices.restoreDeadlineAt,
        });
        return created!;
      });
      if (!counter) return c.json({ error: 'invalid_takedown_transition' }, 409);
    log.info({ noticeId, counterNoticeId: counter.id }, 'takedown.counter_submitted');
    return c.json({ counterNotice: counter }, 202);
  })
  .use('/admin/*', requireSession, requireAdmin)
  .get('/admin/takedowns', async (c) => {
    const status = c.req.query('status');
    const validStatus = schema.takedownStatusEnum.enumValues.find((value) => value === status);
    const query = db
      .select()
      .from(schema.takedownNotices)
      .orderBy(desc(schema.takedownNotices.createdAt))
      .limit(100);
    const notices = validStatus
      ? await query.where(eq(schema.takedownNotices.status, validStatus))
      : await query;
    return c.json({ notices });
  })
  .post('/admin/takedowns/:id/actions', zValidator('json', reviewSchema), async (c) => {
    const noticeId = c.req.param('id');
    const { action, notes } = c.req.valid('json');
    const reviewerId = c.get('user')!.id;
    const now = new Date();

    if ((action === 'reject' || action === 'court_action') && !notes) {
      return c.json({ error: 'review_notes_required' }, 400);
    }

    if (action === 'begin_review') {
      const [updated] = await db
        .update(schema.takedownNotices)
        .set({
          status: 'under_review',
          reviewedBy: reviewerId,
          reviewedAt: now,
          reviewNotes: notes ?? null,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.takedownNotices.id, noticeId),
            eq(schema.takedownNotices.status, 'submitted'),
          ),
        )
        .returning({ id: schema.takedownNotices.id, status: schema.takedownNotices.status });
      if (!updated) return c.json({ error: 'invalid_takedown_transition' }, 409);
      return c.json({ notice: updated });
    }

    if (action === 'reject') {
      const [updated] = await db
        .update(schema.takedownNotices)
        .set({
          status: 'rejected',
          reviewedBy: reviewerId,
          reviewedAt: now,
          reviewNotes: notes!,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.takedownNotices.id, noticeId),
            inArray(schema.takedownNotices.status, ['submitted', 'under_review']),
          ),
        )
        .returning({ id: schema.takedownNotices.id, status: schema.takedownNotices.status });
      if (!updated) return c.json({ error: 'invalid_takedown_transition' }, 409);
      return c.json({ notice: updated });
    }

    if (action === 'remove') {
      const removed = await db.transaction(async (tx) => {
        const [notice] = await tx
          .select({
            episodeId: schema.takedownNotices.episodeId,
            status: schema.takedownNotices.status,
          })
          .from(schema.takedownNotices)
          .where(eq(schema.takedownNotices.id, noticeId))
          .limit(1);
        if (!notice || notice.status !== 'under_review') return null;
        const [episode] = await tx
          .select({ status: schema.episodes.status })
          .from(schema.episodes)
          .where(eq(schema.episodes.id, notice.episodeId))
          .limit(1);
        if (!episode) return null;
        const [updated] = await tx
          .update(schema.takedownNotices)
          .set({
            status: 'removed',
            originalEpisodeStatus: episode.status,
            reviewedBy: reviewerId,
            reviewedAt: now,
            reviewNotes: notes ?? null,
            removedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.takedownNotices.id, noticeId),
              eq(schema.takedownNotices.status, 'under_review'),
            ),
          )
          .returning({ id: schema.takedownNotices.id, status: schema.takedownNotices.status });
        if (!updated) return null;
        await tx
          .update(schema.episodes)
          .set({ status: 'removed', updatedAt: now })
          .where(eq(schema.episodes.id, notice.episodeId));
        return { notice: updated, episodeId: notice.episodeId };
      });
      if (!removed) return c.json({ error: 'invalid_takedown_transition' }, 409);
      try {
        await enqueueRemoval(removed.episodeId, noticeId, legalQueues.cleanupMediaQueue);
      } catch (error) {
        // Access is already disabled in Postgres. Keep the legal action valid
        // and make object cleanup failure loud for an operator to retry.
        log.error(
          { noticeId, episodeId: removed.episodeId, err: String(error) },
          'takedown.cleanup_enqueue_failed',
        );
      }
      log.info({ noticeId, episodeId: removed.episodeId }, 'takedown.removed');
      return c.json({ notice: removed.notice, episodeId: removed.episodeId });
    }

    if (action === 'court_action') {
      const [updated] = await db
        .update(schema.takedownNotices)
        .set({ status: 'court_action', reviewNotes: notes!, updatedAt: now })
        .where(
          and(
            eq(schema.takedownNotices.id, noticeId),
            eq(schema.takedownNotices.status, 'counter_submitted'),
          ),
        )
        .returning({ id: schema.takedownNotices.id, status: schema.takedownNotices.status });
      if (!updated) return c.json({ error: 'invalid_takedown_transition' }, 409);
      return c.json({ notice: updated });
    }

    const [record] = await db
      .select({
        episodeId: schema.takedownNotices.episodeId,
        status: schema.takedownNotices.status,
        restoreEligibleAt: schema.counterNotices.restoreEligibleAt,
      })
      .from(schema.takedownNotices)
      .innerJoin(
        schema.counterNotices,
        eq(schema.counterNotices.takedownNoticeId, schema.takedownNotices.id),
      )
      .where(eq(schema.takedownNotices.id, noticeId))
      .limit(1);
    if (!record || record.status !== 'counter_submitted') {
      return c.json({ error: 'invalid_takedown_transition' }, 409);
    }
    if (record.restoreEligibleAt > now) {
      return c.json(
        { error: 'restore_waiting_period', restoreEligibleAt: record.restoreEligibleAt },
        409,
      );
    }
    const [snapshot] = await db
      .select({ id: schema.snapshots.id })
      .from(schema.snapshots)
      .where(
        and(
          eq(schema.snapshots.episodeId, record.episodeId),
          eq(schema.snapshots.label, 'published-v1'),
        ),
      )
      .orderBy(desc(schema.snapshots.createdAt))
      .limit(1);
    if (!snapshot) return c.json({ error: 'published_snapshot_not_found' }, 409);

    const transitioned = await db.transaction(async (tx) => {
      const [updatedNotice] = await tx
        .update(schema.takedownNotices)
        .set({ status: 'restored', reviewNotes: notes ?? null, updatedAt: now })
        .where(
          and(
            eq(schema.takedownNotices.id, noticeId),
            eq(schema.takedownNotices.status, 'counter_submitted'),
          ),
        )
        .returning({ id: schema.takedownNotices.id });
      if (!updatedNotice) return false;
      const [updatedEpisode] = await tx
        .update(schema.episodes)
        .set({ status: 'publishing', updatedAt: now })
        .where(
          and(eq(schema.episodes.id, record.episodeId), eq(schema.episodes.status, 'removed')),
        )
        .returning({ id: schema.episodes.id });
      if (!updatedEpisode) throw new Error('removed episode transition failed');
      return true;
    });
    if (!transitioned) return c.json({ error: 'invalid_takedown_transition' }, 409);
    const job: PublishJob = {
      episodeId: record.episodeId,
      pipelineRunId: crypto.randomUUID(),
      snapshotId: snapshot.id,
      formats: ['ass', 'srt', 'vtt'],
    };
    try {
      await legalQueues.publishQueue.add('publish', job, {
        jobId: `dmca-restore-${noticeId}`,
        ...JOB_OPTS_DEFAULT,
      });
    } catch (error) {
      await db.transaction(async (tx) => {
        await tx
          .update(schema.episodes)
          .set({ status: 'removed', updatedAt: new Date() })
          .where(
            and(eq(schema.episodes.id, record.episodeId), eq(schema.episodes.status, 'publishing')),
          );
        await tx
          .update(schema.takedownNotices)
          .set({ status: 'counter_submitted', updatedAt: new Date() })
          .where(
            and(
              eq(schema.takedownNotices.id, noticeId),
              eq(schema.takedownNotices.status, 'restored'),
            ),
          );
      });
      log.error({ noticeId, err: String(error) }, 'takedown.restore_enqueue_failed');
      return c.json({ error: 'restore_enqueue_failed' }, 503);
    }
    log.info({ noticeId, episodeId: record.episodeId }, 'takedown.restored');
    return c.json(
      { notice: { id: noticeId, status: 'restored' }, episodeId: record.episodeId },
      202,
    );
  });
}

export const legal = createLegalRoutes();
