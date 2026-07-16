import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@subtitle-fm/db';
import { API_DAILY_LIMITS, generateApiKey } from '../lib/api-access';
import { db } from '../lib/db';
import { requireSession, type AuthVariables } from '../lib/session';

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
});

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const account = new Hono<{ Variables: AuthVariables }>()
  .use('*', requireSession)
  .get('/api-access', async (c) => {
    const userId = c.get('user')!.id;
    const [user] = await db
      .select({ tier: schema.users.apiTier })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) return c.json({ error: 'user_not_found' }, 404);

    const keys = await db
      .select({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        prefix: schema.apiKeys.keyPrefix,
        createdAt: schema.apiKeys.createdAt,
        lastUsedAt: schema.apiKeys.lastUsedAt,
      })
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.userId, userId), isNull(schema.apiKeys.revokedAt)))
      .orderBy(schema.apiKeys.createdAt);

    const now = new Date();
    const since = new Date(now);
    since.setUTCDate(since.getUTCDate() - 29);
    const usageRows = await db
      .select({
        apiKeyId: schema.apiUsageDaily.apiKeyId,
        day: schema.apiUsageDaily.day,
        requestCount: schema.apiUsageDaily.requestCount,
      })
      .from(schema.apiUsageDaily)
      .innerJoin(schema.apiKeys, eq(schema.apiUsageDaily.apiKeyId, schema.apiKeys.id))
      .where(and(eq(schema.apiKeys.userId, userId), gte(schema.apiUsageDaily.day, utcDay(since))));

    const today = utcDay(now);
    return c.json({
      tier: user.tier,
      dailyLimit: API_DAILY_LIMITS[user.tier],
      keys: keys.map((key) => {
        const usage = usageRows.filter((row) => row.apiKeyId === key.id);
        return {
          ...key,
          todayUsage: usage.find((row) => row.day === today)?.requestCount ?? 0,
          last30DaysUsage: usage.reduce((total, row) => total + row.requestCount, 0),
        };
      }),
    });
  })
  .post('/api-keys', zValidator('json', createApiKeySchema), async (c) => {
    const generated = generateApiKey();
    const [key] = await db
      .insert(schema.apiKeys)
      .values({
        userId: c.get('user')!.id,
        name: c.req.valid('json').name,
        keyPrefix: generated.prefix,
        keyHash: generated.hash,
      })
      .returning({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        prefix: schema.apiKeys.keyPrefix,
        createdAt: schema.apiKeys.createdAt,
      });
    return c.json({ ...key!, secret: generated.secret }, 201);
  })
  .delete('/api-keys/:id', async (c) => {
    const [key] = await db
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.apiKeys.id, c.req.param('id')),
          eq(schema.apiKeys.userId, c.get('user')!.id),
          isNull(schema.apiKeys.revokedAt),
        ),
      )
      .returning({ id: schema.apiKeys.id });
    if (!key) return c.json({ error: 'api_key_not_found' }, 404);
    return c.body(null, 204);
  });
