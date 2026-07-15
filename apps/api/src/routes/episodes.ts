import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { advanceEpisodeStatus } from '@subtitle-fm/db';
import { db } from '../lib/db';
import { liveCuesFromSnapshot, type LiveCue } from '@subtitle-fm/shared/yjs';
import { serializeAss, defaultParsedAss, toSrt, toVtt } from '@subtitle-fm/ass';
import { log } from '../lib/log';
import { requireSession, type AuthVariables } from '../lib/session';
import { putObject, presignGet } from '../lib/r2';
import { ingestEpisode } from '../lib/ingest';
import { episodePeaksKey } from '../lib/artifacts';

const createEpisodeSchema = z.object({
  showId: z.string().min(1),
  number: z.number().int().nonnegative(),
  title: z.string().optional(),
  sourceUrl: z.string().url(),
  sourceLanguage: z.string().default('ja'),
  targetLanguage: z.string().default('en'),
});

// Bulk ingestion: one show, many episodes. Item shape == single-create minus
// showId (which is shared, supplied once) so the two endpoints can't drift on
// field validation. Cap bounds the synchronous insert+enqueue loop per request.
const BULK_MAX = 200;
const bulkEpisodeItemSchema = createEpisodeSchema.omit({ showId: true });
const bulkEpisodesSchema = z.object({
  showId: z.string().min(1),
  episodes: z.array(bulkEpisodeItemSchema).min(1).max(BULK_MAX),
});

// Canonical published-artifact keys for an episode. One scheme, two return
// sites (idempotent re-publish + fresh publish) — keep them from drifting.
function publishedKeys(id: string) {
  const base = `subtitles/${id}/published`;
  return { ass: `${base}.ass`, srt: `${base}.srt`, vtt: `${base}.vtt` };
}

export const episodes = new Hono<{ Variables: AuthVariables }>()
  .get('/', async (c) => {
    const rows = await db.select().from(schema.episodes).limit(100);
    return c.json({ episodes: rows });
  })
  .get('/:id', async (c) => {
    const id = c.req.param('id');
    const [row] = await db
      .select()
      .from(schema.episodes)
      .where(eq(schema.episodes.id, id))
      .limit(1);
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json(row);
  })
  .get('/:id/cues', async (c) => {
    const id = c.req.param('id');
    const [ep] = await db
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, id))
      .limit(1);
    if (!ep) return c.json({ error: 'episode_not_found' }, 404);

    const rows = await db
      .select()
      .from(schema.cues)
      .where(eq(schema.cues.episodeId, id))
      .orderBy(asc(schema.cues.orderIndex));
    return c.json({ cues: rows });
  })
  .get('/:id/peaks.dat', async (c) => {
    const id = c.req.param('id');
    const [ep] = await db
      .select({ id: schema.episodes.id, peaksUrl: schema.episodes.peaksUrl })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, id))
      .limit(1);
    if (!ep) return c.json({ error: 'episode_not_found' }, 404);
    if (!ep.peaksUrl) return c.json({ error: 'waveform_not_ready' }, 404);
    const url = await presignGet({ bucket: 'peaks', key: episodePeaksKey(id) });
    return c.redirect(url, 302);
  })
  .get('/:id/subtitle.srt', async (c) => {
    const id = c.req.param('id');
    const [ep] = await db
      .select({ id: schema.episodes.id, status: schema.episodes.status })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, id))
      .limit(1);
    if (!ep) return c.json({ error: 'episode_not_found' }, 404);
    if (ep.status !== 'published') return c.json({ error: 'not_published' }, 404);
    const url = await presignGet({ bucket: 'media', key: `subtitles/${id}/published.srt` });
    return c.redirect(url, 302);
  })
  .get('/:id/subtitle.vtt', async (c) => {
    const id = c.req.param('id');
    const [ep] = await db
      .select({ id: schema.episodes.id, status: schema.episodes.status })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, id))
      .limit(1);
    if (!ep) return c.json({ error: 'episode_not_found' }, 404);
    if (ep.status !== 'published') return c.json({ error: 'not_published' }, 404);
    const url = await presignGet({ bucket: 'media', key: `subtitles/${id}/published.vtt` });
    return c.redirect(url, 302);
  })
  .post('/:id/publish', requireSession, async (c) => {
    const id = c.req.param('id') as string;
    const [ep] = await db
      .select({ id: schema.episodes.id, status: schema.episodes.status })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, id))
      .limit(1);
    if (!ep) return c.json({ error: 'episode_not_found' }, 404);
    // Already published: idempotent no-op. Do NOT re-serialize/overwrite the
    // canonical artifact with possibly-newer edited state. (A failed status flip
    // leaves status non-published, so a genuine retry still completes below.)
    if (ep.status === 'published') {
      const keys = publishedKeys(id);
      return c.json({ status: 'published', key: keys.ass, keys });
    }
    if (!['ready_for_edit', 'in_review'].includes(ep.status))
      return c.json({ error: 'not_publishable', currentStatus: ep.status }, 409);

    const [snap] = await db
      .select({ yjsState: schema.snapshots.yjsState })
      .from(schema.snapshots)
      .where(and(eq(schema.snapshots.episodeId, id), eq(schema.snapshots.label, 'live')))
      .limit(1);
    let cues: LiveCue[];
    if (snap) {
      cues = liveCuesFromSnapshot(snap.yjsState);
    } else {
      const rows = await db
        .select()
        .from(schema.cues)
        .where(eq(schema.cues.episodeId, id))
        .orderBy(asc(schema.cues.orderIndex));
      cues = rows.map((r) => ({
        id: r.id,
        orderIndex: r.orderIndex,
        startMs: r.startMs,
        endMs: r.endMs,
        text: r.text,
        styleName: r.styleName,
        speakerId: r.speakerId,
        confidence: r.confidence,
        needsReview: r.needsReview,
      }));
    }

    if (cues.length === 0) return c.json({ error: 'no_cues' }, 409);
    const unreviewed = cues.filter((cue) => cue.needsReview).length;
    if (unreviewed > 0) return c.json({ error: 'unreviewed_cues', count: unreviewed }, 409);

    const keys = publishedKeys(id);

    let ass: string, srt: string, vtt: string;
    try {
      const parsed = defaultParsedAss(cues);
      ass = serializeAss(parsed); // throws on styleName/speaker comma or literal newline → 422 before srt/vtt or any upload
      srt = toSrt(parsed);
      vtt = toVtt(parsed);
    } catch (e) {
      return c.json({ error: 'serialize_failed', detail: (e as Error).message }, 422);
    }

    try {
      // artifacts before the status flip; any failure leaves status unpublished (retry-safe)
      await putObject('media', keys.ass, ass, 'text/plain; charset=utf-8');
      await putObject('media', keys.srt, srt, 'application/x-subrip; charset=utf-8');
      await putObject('media', keys.vtt, vtt, 'text/vtt; charset=utf-8');
    } catch (e) {
      return c.json({ error: 'r2_upload_failed', detail: (e as Error).message }, 502);
    }

    const result = await advanceEpisodeStatus(db, id, {
      from: ['ready_for_edit', 'in_review'],
      to: 'published',
    });
    if (!result.advanced && result.currentStatus !== 'published')
      return c.json({ error: 'not_publishable', currentStatus: result.currentStatus }, 409);
    return c.json({ status: 'published', key: keys.ass, keys });
  })
  // Declared before POST '/' so the static segment is unambiguous. Bulk ingest:
  // one show, many episodes, idempotent per item. Partial success is normal, so
  // it always returns 200 with a per-item breakdown (not a single status code).
  .post('/bulk', requireSession, zValidator('json', bulkEpisodesSchema), async (c) => {
    const input = c.req.valid('json');

    const [show] = await db
      .select({ id: schema.shows.id })
      .from(schema.shows)
      .where(eq(schema.shows.id, input.showId))
      .limit(1);
    if (!show) {
      return c.json({ error: 'show_not_found', showId: input.showId }, 404);
    }

    const created: { number: number; id: string }[] = [];
    const skipped: { number: number; existingId: string }[] = [];
    const failed: { number: number; error: string }[] = [];

    // Sequential on purpose: each insert autocommits before the next, so an
    // in-batch duplicate number conflicts on the (show_id, number) unique index
    // and is skipped — not a parallel race. Do NOT convert to Promise.all
    // without a different in-batch dedup strategy.
    for (const item of input.episodes) {
      const result = await ingestEpisode({ showId: input.showId, ...item });
      if (result.status === 'created') created.push({ number: item.number, id: result.episode.id });
      else if (result.status === 'exists')
        skipped.push({ number: item.number, existingId: result.existingId });
      else failed.push({ number: item.number, error: result.error });
    }

    log.info(
      {
        showId: input.showId,
        created: created.length,
        skipped: skipped.length,
        failed: failed.length,
      },
      'episodes.bulk_created',
    );
    return c.json({ created, skipped, failed });
  })
  .post('/', requireSession, zValidator('json', createEpisodeSchema), async (c) => {
    const input = c.req.valid('json');

    const [show] = await db
      .select({ id: schema.shows.id })
      .from(schema.shows)
      .where(eq(schema.shows.id, input.showId))
      .limit(1);
    if (!show) {
      return c.json({ error: 'show_not_found', showId: input.showId }, 404);
    }

    const result = await ingestEpisode(input);
    if (result.status === 'exists')
      return c.json({ error: 'episode_exists', id: result.existingId }, 409);
    if (result.status === 'failed') return c.json({ error: result.error }, 500);

    log.info({ episodeId: result.episode.id, showId: input.showId }, 'episode.created');
    return c.json(result.episode, 201);
  });
