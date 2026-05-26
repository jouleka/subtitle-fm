import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { db } from '../lib/db';
import { preprocessQueue } from '../lib/queue';
import { JOB_OPTS_DEFAULT, type PreprocessJob } from '@subtitle-fm/shared';
import { log } from '../lib/log';
import { requireSession, type AuthVariables } from '../lib/session';

const createEpisodeSchema = z.object({
  showId: z.string().min(1),
  number: z.number().int().nonnegative(),
  title: z.string().optional(),
  sourceUrl: z.string().url(),
  sourceLanguage: z.string().default('ja'),
  targetLanguage: z.string().default('en'),
});

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

    const job: PreprocessJob = {
      episodeId: episode.id,
      pipelineRunId: crypto.randomUUID(),
      sourceUrl: input.sourceUrl,
    };
    await preprocessQueue.add('preprocess', job, {
      jobId: episode.id,
      ...JOB_OPTS_DEFAULT,
    });

    log.info({ episodeId: episode.id, showId: input.showId }, 'episode.created');
    return c.json(episode, 201);
  });
