import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { CreateGlossaryTerm, UpdateGlossaryTerm } from '@subtitle-fm/shared';
import { db } from '../lib/db';
import { requireSession, type AuthVariables } from '../lib/session';

export const glossary = new Hono<{ Variables: AuthVariables }>()
  .get('/', async (c) => {
    const showId = c.req.param('showId') as string;
    const rows = await db
      .select()
      .from(schema.glossaryTerms)
      .where(eq(schema.glossaryTerms.showId, showId))
      .orderBy(asc(schema.glossaryTerms.sourceText));
    return c.json({ glossaryTerms: rows });
  })
  .post('/', requireSession, zValidator('json', CreateGlossaryTerm), async (c) => {
    const showId = c.req.param('showId') as string;
    const input = c.req.valid('json');
    const dupe = await db
      .select({ id: schema.glossaryTerms.id })
      .from(schema.glossaryTerms)
      .where(
        and(
          eq(schema.glossaryTerms.showId, showId),
          eq(schema.glossaryTerms.sourceText, input.sourceText),
        ),
      )
      .limit(1);
    if (dupe.length) return c.json({ error: 'duplicate_source' }, 409);
    const [row] = await db
      .insert(schema.glossaryTerms)
      .values({
        showId,
        sourceText: input.sourceText,
        targetText: input.targetText,
        kind: input.kind,
        notes: input.notes ?? null,
      })
      .returning();
    return c.json(row, 201);
  })
  .patch('/:termId', requireSession, zValidator('json', UpdateGlossaryTerm), async (c) => {
    const showId = c.req.param('showId') as string;
    const termId = c.req.param('termId') as string;
    const input = c.req.valid('json');
    const [row] = await db
      .update(schema.glossaryTerms)
      .set(input)
      .where(and(eq(schema.glossaryTerms.id, termId), eq(schema.glossaryTerms.showId, showId)))
      .returning();
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json(row);
  })
  .delete('/:termId', requireSession, async (c) => {
    const showId = c.req.param('showId') as string;
    const termId = c.req.param('termId') as string;
    const [row] = await db
      .delete(schema.glossaryTerms)
      .where(and(eq(schema.glossaryTerms.id, termId), eq(schema.glossaryTerms.showId, showId)))
      .returning();
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true });
  });
