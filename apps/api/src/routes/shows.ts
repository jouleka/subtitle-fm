import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { db } from '../lib/db';

const createShowSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'lowercase letters, digits, and hyphens only'),
  description: z.string().optional(),
  malId: z.string().optional(),
  anilistId: z.string().optional(),
  kitsuId: z.string().optional(),
  coverUrl: z.string().url().optional(),
});

export const shows = new Hono()
  .get('/', async (c) => {
    const rows = await db.select().from(schema.shows).limit(100);
    return c.json({ shows: rows });
  })
  .get('/:id', async (c) => {
    const id = c.req.param('id');
    const [row] = await db.select().from(schema.shows).where(eq(schema.shows.id, id)).limit(1);
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json(row);
  })
  .post('/', zValidator('json', createShowSchema), async (c) => {
    const input = c.req.valid('json');
    const [row] = await db
      .insert(schema.shows)
      .values({
        id: input.id,
        title: input.title,
        slug: input.slug,
        description: input.description ?? null,
        malId: input.malId ?? null,
        anilistId: input.anilistId ?? null,
        kitsuId: input.kitsuId ?? null,
        coverUrl: input.coverUrl ?? null,
      })
      .returning();
    return c.json(row, 201);
  });
