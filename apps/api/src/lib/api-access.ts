import { createHash, randomBytes } from 'node:crypto';
import type { Context, MiddlewareHandler, Next } from 'hono';
import { and, eq, isNull, sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { schema } from '@subtitle-fm/db';
import { db } from './db';
import type { AuthVariables } from './session';

export type ApiTier = (typeof schema.apiTierEnum.enumValues)[number];
export type ApiConsumerKind = 'anonymous' | 'account' | 'api_key';

export interface ApiConsumer {
  kind: ApiConsumerKind;
  subject: string;
  tier: ApiTier;
  apiKeyId: string | null;
}

export type ApiAccessVariables = AuthVariables & { apiConsumer: ApiConsumer };

export const API_DAILY_LIMITS = {
  anonymous: 5,
  free: 20,
  dev: 1_000,
  pro: null,
} as const;

export interface BucketResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

type ResolveConsumer = (
  c: Context<{ Variables: ApiAccessVariables }>,
) => Promise<ApiConsumer | Response>;
type ConsumeBucket = (subject: string, capacity: number, nowMs: number) => Promise<BucketResult>;
type MeterKey = (apiKeyId: string, now: Date) => Promise<void>;

const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local refill_per_ms = capacity / 86400000
local values = redis.call('HMGET', key, 'tokens', 'updated_at')
local tokens = tonumber(values[1]) or capacity
local updated_at = tonumber(values[2]) or now
tokens = math.min(capacity, tokens + math.max(0, now - updated_at) * refill_per_ms)
local allowed = 0
local retry_after = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry_after = math.ceil((1 - tokens) / refill_per_ms / 1000)
end
redis.call('HSET', key, 'tokens', tokens, 'updated_at', now)
redis.call('PEXPIRE', key, 172800000)
return { allowed, math.floor(tokens), retry_after }
`;

export const rateLimitConnection = new IORedis(
  process.env.REDIS_URL ?? 'redis://localhost:6379',
  { maxRetriesPerRequest: null },
);

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function generateApiKey(): { secret: string; prefix: string; hash: string } {
  const secret = `sfm_live_${randomBytes(32).toString('base64url')}`;
  return {
    secret,
    prefix: `${secret.slice(0, 18)}…`,
    hash: hashApiKey(secret),
  };
}

export function extractApiKey(headers: Headers): string | null {
  const explicit = headers.get('x-api-key')?.trim();
  if (explicit) return explicit;
  const authorization = headers.get('authorization')?.trim() ?? '';
  const match = /^Bearer\s+(sfm_(?:live|test)_[A-Za-z0-9_-]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

function dailyLimit(consumer: ApiConsumer): number | null {
  if (consumer.kind === 'anonymous') return API_DAILY_LIMITS.anonymous;
  return API_DAILY_LIMITS[consumer.tier];
}

function anonymousSubject(c: Context): string {
  const forwarded =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip');
  return `anonymous:${createHash('sha256').update(forwarded || 'unknown').digest('hex').slice(0, 24)}`;
}

export async function resolveApiConsumer(
  c: Context<{ Variables: ApiAccessVariables }>,
): Promise<ApiConsumer | Response> {
  const presentedKey = extractApiKey(c.req.raw.headers);
  if (presentedKey) {
    const [key] = await db
      .select({ id: schema.apiKeys.id, tier: schema.users.apiTier })
      .from(schema.apiKeys)
      .innerJoin(schema.users, eq(schema.apiKeys.userId, schema.users.id))
      .where(and(eq(schema.apiKeys.keyHash, hashApiKey(presentedKey)), isNull(schema.apiKeys.revokedAt)))
      .limit(1);
    if (!key) return c.json({ error: 'api_key_invalid' }, 401);
    return { kind: 'api_key', subject: `key:${key.id}`, tier: key.tier, apiKeyId: key.id };
  }

  const sessionUser = c.get('user');
  if (sessionUser) {
    const [account] = await db
      .select({ tier: schema.users.apiTier })
      .from(schema.users)
      .where(eq(schema.users.id, sessionUser.id))
      .limit(1);
    if (!account) return c.json({ error: 'account_not_found' }, 401);
    return {
      kind: 'account',
      subject: `account:${sessionUser.id}`,
      tier: account.tier,
      apiKeyId: null,
    };
  }

  return {
    kind: 'anonymous',
    subject: anonymousSubject(c),
    tier: 'free',
    apiKeyId: null,
  };
}

export async function consumeRedisBucket(
  subject: string,
  capacity: number,
  nowMs: number,
): Promise<BucketResult> {
  const result = (await rateLimitConnection.eval(
    TOKEN_BUCKET_LUA,
    1,
    `sfm:api-rate:${subject}`,
    String(capacity),
    String(nowMs),
  )) as [number, number, number];
  return {
    allowed: result[0] === 1,
    remaining: Number(result[1]),
    retryAfterSeconds: Number(result[2]),
  };
}

export async function meterApiKey(apiKeyId: string, now: Date): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.apiUsageDaily)
      .values({ apiKeyId, day, requestCount: 1 })
      .onConflictDoUpdate({
        target: [schema.apiUsageDaily.apiKeyId, schema.apiUsageDaily.day],
        set: {
          requestCount: sql`${schema.apiUsageDaily.requestCount} + 1`,
          updatedAt: now,
        },
      });
    await tx
      .update(schema.apiKeys)
      .set({ lastUsedAt: now })
      .where(eq(schema.apiKeys.id, apiKeyId));
  });
}

export function createApiRateLimitMiddleware(deps: {
  resolveConsumer: ResolveConsumer;
  consumeBucket: ConsumeBucket;
  meterKey: MeterKey;
  now?: () => Date;
}): MiddlewareHandler<{ Variables: ApiAccessVariables }> {
  return async (c, next: Next) => {
    const consumer = await deps.resolveConsumer(c);
    if (consumer instanceof Response) return consumer;

    const now = deps.now?.() ?? new Date();
    const limit = dailyLimit(consumer);
    c.set('apiConsumer', consumer);
    c.header('X-RateLimit-Policy', limit === null ? 'unlimited' : `${limit};w=86400`);

    if (limit !== null) {
      let bucket: BucketResult;
      try {
        bucket = await deps.consumeBucket(consumer.subject, limit, now.getTime());
      } catch {
        return c.json({ error: 'rate_limit_unavailable' }, 503);
      }
      c.header('X-RateLimit-Limit', String(limit));
      c.header('X-RateLimit-Remaining', String(bucket.remaining));
      if (!bucket.allowed) {
        c.header('Retry-After', String(Math.max(1, bucket.retryAfterSeconds)));
        return c.json({ error: 'rate_limit_exceeded', retryAfterSeconds: bucket.retryAfterSeconds }, 429);
      }
    }

    if (consumer.apiKeyId) await deps.meterKey(consumer.apiKeyId, now);
    await next();
  };
}

export const apiRateLimit = createApiRateLimitMiddleware({
  resolveConsumer: resolveApiConsumer,
  consumeBucket: consumeRedisBucket,
  meterKey: meterApiKey,
});
