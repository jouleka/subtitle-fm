import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { db } from '../lib/db';
import { computeHmacSha256Hex } from '../lib/hmac';
import { lemonEventId } from '../lib/lemonsqueezy';
import { webhooksLemonSqueezy } from './webhooks-lemonsqueezy';

const USER = '44999999-0000-4000-8000-000000000001';
const payloads: string[] = [];
process.env.LEMONSQUEEZY_WEBHOOK_SECRET = 'sfm44-secret';
process.env.LEMONSQUEEZY_STORE_ID = '44';
process.env.LEMONSQUEEZY_DEV_VARIANT_ID = '440';
process.env.LEMONSQUEEZY_PRO_VARIANT_ID = '441';

function payload(status: string, eventName: string, variant = '441') {
  const raw = JSON.stringify({
    meta: { event_name: eventName, custom_data: { user_id: USER } },
    data: {
      type: 'subscriptions',
      id: 'sfm44-subscription',
      attributes: {
        store_id: 44,
        customer_id: 4400,
        variant_id: Number(variant),
        status,
        renews_at: '2026-08-16T00:00:00.000Z',
        ends_at: status === 'expired' ? '2026-07-15T00:00:00.000Z' : null,
        test_mode: true,
      },
    },
  });
  payloads.push(raw);
  return raw;
}

async function send(raw: string, signature = computeHmacSha256Hex(raw, 'sfm44-secret')) {
  return webhooksLemonSqueezy.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': signature },
    body: raw,
  });
}

beforeAll(async () => {
  await db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
  await db.insert(schema.users).values({
    id: USER,
    handle: 'sfm44-billing',
    email: 'sfm44@example.com',
  });
});

afterAll(async () => {
  await db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
  const ids = [...new Set(payloads.map(lemonEventId))];
  if (ids.length)
    await db.delete(schema.webhookEvents).where(inArray(schema.webhookEvents.id, ids));
});

describe('Lemon Squeezy webhook sync (SFM-44)', () => {
  test('rejects a bad signature without mutating entitlement', async () => {
    expect((await send(payload('active', 'subscription_created'), 'bad')).status).toBe(401);
  });

  test('activates, deduplicates, and expires a paid API tier', async () => {
    const active = payload('active', 'subscription_created');
    const first = await send(active);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: 'ok', duplicate: false });
    const replay = await send(active);
    expect(await replay.json()).toEqual({ status: 'ok', duplicate: true });

    let [user] = await db
      .select({ tier: schema.users.apiTier })
      .from(schema.users)
      .where(eq(schema.users.id, USER));
    expect(user!.tier).toBe('pro');
    const [subscription] = await db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.userId, USER));
    expect(subscription!.lemonSubscriptionId).toBe('sfm44-subscription');
    expect(subscription!.testMode).toBe(true);

    const expired = await send(payload('expired', 'subscription_expired'));
    expect(expired.status).toBe(200);
    [user] = await db
      .select({ tier: schema.users.apiTier })
      .from(schema.users)
      .where(eq(schema.users.id, USER));
    expect(user!.tier).toBe('free');
  });
});
