import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@subtitle-fm/db';
import { db } from '../lib/db';
import { requireSession, type AuthVariables } from '../lib/session';

const pageSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.string().datetime().optional(),
    beforeId: z.string().uuid().optional(),
  })
  .refine((query) => Boolean(query.before) === Boolean(query.beforeId), {
    message: 'before and beforeId must be supplied together',
  });

const cuePageSchema = z.object({ limit: z.coerce.number().int().min(1).max(20).default(5) });

const auditFields = {
  id: schema.auditLog.id,
  episodeId: schema.auditLog.episodeId,
  cueId: schema.auditLog.cueId,
  userId: schema.auditLog.userId,
  userHandle: schema.users.handle,
  fieldChanged: schema.auditLog.fieldChanged,
  oldValue: schema.auditLog.oldValue,
  newValue: schema.auditLog.newValue,
  ts: schema.auditLog.ts,
};

export const audit = new Hono<{ Variables: AuthVariables }>()
  .use('*', requireSession)
  .get('/', zValidator('query', pageSchema), async (c) => {
    const episodeId = c.req.param('episodeId') as string;
    const { limit, before, beforeId } = c.req.valid('query');
    const cursor = before && beforeId
      ? or(
          lt(schema.auditLog.ts, new Date(before)),
          and(eq(schema.auditLog.ts, new Date(before)), lt(schema.auditLog.id, beforeId)),
        )
      : undefined;
    const rows = await db
      .select(auditFields)
      .from(schema.auditLog)
      .leftJoin(schema.users, eq(schema.auditLog.userId, schema.users.id))
      .where(
        cursor
          ? and(eq(schema.auditLog.episodeId, episodeId), cursor)
          : eq(schema.auditLog.episodeId, episodeId),
      )
      .orderBy(desc(schema.auditLog.ts), desc(schema.auditLog.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit);
    const last = hasMore ? events.at(-1) : null;
    return c.json({
      events,
      hasMore,
      nextBefore: last?.ts ?? null,
      nextBeforeId: last?.id ?? null,
    });
  })
  .get('/cues/:cueId', zValidator('query', cuePageSchema), async (c) => {
    const episodeId = c.req.param('episodeId') as string;
    const rows = await db
      .select(auditFields)
      .from(schema.auditLog)
      .leftJoin(schema.users, eq(schema.auditLog.userId, schema.users.id))
      .where(
        and(
          eq(schema.auditLog.episodeId, episodeId),
          eq(schema.auditLog.cueId, c.req.param('cueId')),
        ),
      )
      .orderBy(desc(schema.auditLog.ts), desc(schema.auditLog.id))
      .limit(c.req.valid('query').limit);
    return c.json({ events: rows });
  });
