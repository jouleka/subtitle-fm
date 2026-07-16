import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import {
  consumeRedisBucket,
  createApiRateLimitMiddleware,
  extractApiKey,
  generateApiKey,
  hashApiKey,
  meterApiKey,
  rateLimitConnection,
  type ApiAccessVariables,
  type ApiConsumer,
} from './api-access';
import { db } from './db';
import { account } from '../routes/account';
import type { AuthVariables } from './session';
import { app as fullApp } from '../index';

const USER_ID = '43434343-4343-4343-8343-434343434343';

function consumer(overrides: Partial<ApiConsumer> = {}): ApiConsumer {
  return {
    kind: 'anonymous',
    subject: 'anonymous:test',
    tier: 'free',
    apiKeyId: null,
    ...overrides,
  };
}

function rateLimitedApp(config: {
  resolved: ApiConsumer;
  consume?: (subject: string, capacity: number, nowMs: number) => Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }>;
  meter?: (id: string, now: Date) => Promise<void>;
}) {
  const app = new Hono<{ Variables: ApiAccessVariables }>();
  app.use('*', async (c, next) => {
    c.set('user', null);
    c.set('session', null);
    await next();
  });
  app.use(
    '*',
    createApiRateLimitMiddleware({
      resolveConsumer: async () => config.resolved,
      consumeBucket: config.consume ?? (async () => ({ allowed: true, remaining: 4, retryAfterSeconds: 0 })),
      meterKey: config.meter ?? (async () => {}),
      now: () => new Date('2026-07-16T12:00:00.000Z'),
    }),
  );
  app.get('/', (c) => c.json({ kind: c.get('apiConsumer').kind }));
  return app;
}

describe('API key primitives (SFM-43)', () => {
  test('generates a one-time secret while storing only its SHA-256 hash and display prefix', () => {
    const key = generateApiKey();
    expect(key.secret).toMatch(/^sfm_live_[A-Za-z0-9_-]+$/);
    expect(key.hash).toBe(hashApiKey(key.secret));
    expect(key.hash).not.toContain(key.secret);
    expect(key.prefix.endsWith('…')).toBe(true);
  });

  test('accepts X-API-Key or a Subtitle.fm bearer token', () => {
    expect(extractApiKey(new Headers({ 'x-api-key': 'sfm_live_header' }))).toBe('sfm_live_header');
    expect(extractApiKey(new Headers({ authorization: 'Bearer sfm_test_bearer' }))).toBe('sfm_test_bearer');
    expect(extractApiKey(new Headers({ authorization: 'Bearer unrelated' }))).toBeNull();
  });
});

describe('tier-aware rate middleware (SFM-43)', () => {
  test('anonymous requests consume the five-per-day token bucket and expose headers', async () => {
    let capacity = 0;
    const app = rateLimitedApp({
      resolved: consumer(),
      consume: async (_subject, limit) => {
        capacity = limit;
        return { allowed: true, remaining: 4, retryAfterSeconds: 0 };
      },
    });
    const response = await app.request('/');
    expect(response.status).toBe(200);
    expect(capacity).toBe(5);
    expect(response.headers.get('x-ratelimit-limit')).toBe('5');
    expect(response.headers.get('x-ratelimit-remaining')).toBe('4');
  });

  test('a depleted bucket returns 429 and Retry-After without reaching the handler', async () => {
    const app = rateLimitedApp({
      resolved: consumer({ kind: 'account', subject: 'account:test' }),
      consume: async () => ({ allowed: false, remaining: 0, retryAfterSeconds: 321 }),
    });
    const response = await app.request('/');
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('321');
    expect(await response.json()).toEqual({ error: 'rate_limit_exceeded', retryAfterSeconds: 321 });
  });

  test('pro keys bypass the bucket but are still included in the usage meter', async () => {
    let consumed = false;
    let metered = '';
    const app = rateLimitedApp({
      resolved: consumer({ kind: 'api_key', tier: 'pro', apiKeyId: 'key-pro' }),
      consume: async () => {
        consumed = true;
        return { allowed: true, remaining: 0, retryAfterSeconds: 0 };
      },
      meter: async (id) => {
        metered = id;
      },
    });
    const response = await app.request('/');
    expect(response.status).toBe(200);
    expect(consumed).toBe(false);
    expect(metered).toBe('key-pro');
    expect(response.headers.get('x-ratelimit-policy')).toBe('unlimited');
  });

  test('the OrbStack Redis bucket consumes capacity atomically', async () => {
    const subject = `test:${crypto.randomUUID()}`;
    try {
      expect((await consumeRedisBucket(subject, 2, 1_000)).allowed).toBe(true);
      expect((await consumeRedisBucket(subject, 2, 1_000)).allowed).toBe(true);
      const third = await consumeRedisBucket(subject, 2, 1_000);
      expect(third.allowed).toBe(false);
      expect(third.remaining).toBe(0);
      expect(third.retryAfterSeconds).toBe(43_200);
    } finally {
      await rateLimitConnection.del(`sfm:api-rate:${subject}`);
    }
  });

  test('the live /v1 subtitle surface is metered while the original Stremio route stays compatible', async () => {
    const response = await fullApp.request('/v1/subtitles/movie/tt-does-not-exist', {
      headers: { 'x-forwarded-for': `test-${crypto.randomUUID()}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-ratelimit-limit')).toBe('5');
    expect(await response.json()).toEqual({ subtitles: [] });

    const invalidKey = await fullApp.request('/v1/subtitles/movie/tt-does-not-exist', {
      headers: { authorization: 'Bearer sfm_test_not-a-real-key' },
    });
    expect(invalidKey.status).toBe(401);
    expect(await invalidKey.json()).toEqual({ error: 'api_key_invalid' });
  });
});

describe('API key dashboard persistence (SFM-43)', () => {
  const authed = new Hono<{ Variables: AuthVariables }>();
  authed.use('*', async (c, next) => {
    c.set('user', {
      id: USER_ID,
      name: 'meter-user',
      email: 'meter@example.com',
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      reputation: 0,
      role: 'editor',
      discordId: null,
    });
    c.set('session', null);
    await next();
  });
  authed.route('/account', account);

  beforeAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, USER_ID));
    await db.insert(schema.users).values({
      id: USER_ID,
      handle: 'meter-user-sfm-43',
      email: 'meter-sfm-43@example.com',
    });
  });

  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, USER_ID));
  });

  test('creates, reports, meters, and revokes a key without ever returning its hash', async () => {
    const createResponse = await authed.request('/account/api-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'CI provider' }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { id: string; secret: string; prefix: string };
    expect(created.secret.startsWith('sfm_live_')).toBe(true);

    const [stored] = await db
      .select({ hash: schema.apiKeys.keyHash })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, created.id));
    expect(stored?.hash).toBe(hashApiKey(created.secret));
    expect(stored?.hash).not.toBe(created.secret);

    await meterApiKey(created.id, new Date());
    const dashboardResponse = await authed.request('/account/api-access');
    expect(dashboardResponse.status).toBe(200);
    const dashboard = (await dashboardResponse.json()) as {
      tier: string;
      dailyLimit: number;
      keys: Array<{ id: string; todayUsage: number; last30DaysUsage: number; hash?: string }>;
    };
    expect(dashboard.tier).toBe('free');
    expect(dashboard.dailyLimit).toBe(20);
    expect(dashboard.keys[0]?.todayUsage).toBe(1);
    expect(dashboard.keys[0]?.last30DaysUsage).toBe(1);
    expect(dashboard.keys[0]?.hash).toBeUndefined();

    const revokeResponse = await authed.request(`/account/api-keys/${created.id}`, { method: 'DELETE' });
    expect(revokeResponse.status).toBe(204);
    const afterRevoke = (await (await authed.request('/account/api-access')).json()) as { keys: unknown[] };
    expect(afterRevoke.keys).toEqual([]);
  });
});
