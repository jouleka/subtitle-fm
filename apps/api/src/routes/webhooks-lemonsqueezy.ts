import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { db } from '../lib/db';
import {
  entitledTier,
  lemonEventId,
  lemonWebhookSchema,
  verifyLemonSignature,
} from '../lib/lemonsqueezy';
import { log } from '../lib/log';

function date(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

export const webhooksLemonSqueezy = new Hono();
webhooksLemonSqueezy.use(
  '*',
  bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json({ error: 'payload_too_large' }, 413),
  }),
);
webhooksLemonSqueezy.post('/', async (c) => {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: 'webhook_not_configured' }, 503);
  const raw = await c.req.text();
  if (!verifyLemonSignature(raw, c.req.header('X-Signature') ?? '', secret)) {
    return c.json({ error: 'bad_signature' }, 401);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return c.json({ error: 'bad_payload' }, 400);
  }
  const result = lemonWebhookSchema.safeParse(json);
  if (!result.success) return c.json({ error: 'bad_payload' }, 400);
  const payload = result.data;
  const attributes = payload.data.attributes;
  const configuredStore = process.env.LEMONSQUEEZY_STORE_ID;
  if (configuredStore && String(attributes.store_id) !== configuredStore) {
    return c.json({ error: 'store_mismatch' }, 400);
  }

  const existing = await db
    .select({ userId: schema.subscriptions.userId })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.lemonSubscriptionId, payload.data.id))
    .limit(1);
  const userId = payload.meta.custom_data.user_id ?? existing[0]?.userId;
  if (!userId) return c.json({ error: 'missing_user_id' }, 400);
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) return c.json({ error: 'user_not_found' }, 400);

  const eventId = lemonEventId(raw);
  const endsAt = date(attributes.ends_at);
  const tier = entitledTier(String(attributes.variant_id), attributes.status, endsAt);
  const duplicate = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.webhookEvents)
      .values({
        id: eventId,
        source: 'lemonsqueezy',
        stage: payload.meta.event_name,
        status: attributes.status,
        payload,
      })
      .onConflictDoNothing({ target: schema.webhookEvents.id })
      .returning({ id: schema.webhookEvents.id });
    if (inserted.length === 0) return true;
    await tx
      .insert(schema.subscriptions)
      .values({
        userId,
        lemonSubscriptionId: payload.data.id,
        lemonCustomerId: String(attributes.customer_id),
        lemonVariantId: String(attributes.variant_id),
        status: attributes.status,
        renewsAt: date(attributes.renews_at),
        endsAt,
        testMode: attributes.test_mode,
      })
      .onConflictDoUpdate({
        target: schema.subscriptions.userId,
        set: {
          lemonSubscriptionId: payload.data.id,
          lemonCustomerId: String(attributes.customer_id),
          lemonVariantId: String(attributes.variant_id),
          status: attributes.status,
          renewsAt: date(attributes.renews_at),
          endsAt,
          testMode: attributes.test_mode,
          updatedAt: new Date(),
        },
      });
    await tx.update(schema.users).set({ apiTier: tier }).where(eq(schema.users.id, userId));
    return false;
  });
  log.info({ eventId, userId, tier, duplicate }, 'webhook.lemonsqueezy.processed');
  return c.json({ status: 'ok', duplicate });
});
