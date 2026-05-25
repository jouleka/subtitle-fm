import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { db } from '../lib/db';
import { preprocessQueue, type PreprocessJob } from '../lib/queue';
import { log } from '../lib/log';

const createEpisodeSchema = z.object({
  showId: z.string().min(1),
  number: z.number().int().nonnegative(),
  title: z.string().optional(),
  sourceUrl: z.string().url(),
  sourceLanguage: z.string().default('ja'),
  targetLanguage: z.string().default('en'),
});

export const episodes = new Hono()
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
  .post('/', zValidator('json', createEpisodeSchema), async (c) => {
    const input = c.req.valid('json');

    const [show] = await db
      .select({ id: schema.shows.id })
      .from(schema.shows)
      .where(eq(schema.shows.id, input.showId))
      .limit(1);
    if (!show) {
      return c.json({ error: 'show_not_found', showId: input.showId }, 404);
    }

    const [existing] = await db
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .where(
        and(
          eq(schema.episodes.showId, input.showId),
          eq(schema.episodes.number, input.number),
        ),
      )
      .limit(1);
    if (existing) {
      return c.json({ error: 'episode_exists', id: existing.id }, 409);
    }

    const [episode] = await db
      .insert(schema.episodes)
      .values({
        showId: input.showId,
        number: input.number,
        title: input.title ?? null,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        status: 'uploaded',
      })
      .returning();
    if (!episode) {
      return c.json({ error: 'insert_failed' }, 500);
    }

    const job: PreprocessJob = { episodeId: episode.id, sourceUrl: input.sourceUrl };
    await preprocessQueue.add('preprocess', job, {
      jobId: episode.id,
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    });

    log.info({ episodeId: episode.id, showId: input.showId }, 'episode.created');
    return c.json(episode, 201);
  });
