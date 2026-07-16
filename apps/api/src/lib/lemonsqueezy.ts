import { createHash } from 'node:crypto';
import { z } from 'zod';
import { verifyHmacSha256 } from './hmac';

export type PaidApiTier = 'dev' | 'pro';

const subscriptionAttributes = z.object({
  store_id: z.union([z.string(), z.number()]),
  customer_id: z.union([z.string(), z.number()]),
  variant_id: z.union([z.string(), z.number()]),
  status: z.string().min(1),
  renews_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  test_mode: z.boolean().default(false),
  urls: z.object({ customer_portal: z.string().url().nullable().optional() }).optional(),
});

export const lemonWebhookSchema = z.object({
  meta: z.object({
    event_name: z.string().min(1),
    custom_data: z.object({ user_id: z.string().uuid().optional() }).optional().default({}),
  }),
  data: z.object({
    type: z.literal('subscriptions'),
    id: z.string().min(1),
    attributes: subscriptionAttributes,
  }),
});

export type LemonWebhook = z.infer<typeof lemonWebhookSchema>;

export function lemonEventId(rawBody: string): string {
  return `lemon:${createHash('sha256').update(rawBody).digest('hex')}`;
}

export function verifyLemonSignature(rawBody: string, signature: string, secret: string): boolean {
  return verifyHmacSha256(rawBody, signature, secret);
}

export function variantForTier(tier: PaidApiTier): string | null {
  const value =
    tier === 'dev'
      ? process.env.LEMONSQUEEZY_DEV_VARIANT_ID
      : process.env.LEMONSQUEEZY_PRO_VARIANT_ID;
  return value?.trim() || null;
}

export function tierForVariant(variantId: string): PaidApiTier | null {
  if (variantId === variantForTier('dev')) return 'dev';
  if (variantId === variantForTier('pro')) return 'pro';
  return null;
}

export function entitledTier(
  variantId: string,
  status: string,
  endsAt: Date | null,
  now = new Date(),
): 'free' | PaidApiTier {
  const tier = tierForVariant(variantId);
  if (!tier) return 'free';
  if (status === 'active' || status === 'on_trial') return tier;
  if (status === 'cancelled' && endsAt && endsAt > now) return tier;
  return 'free';
}

async function lemonRequest(path: string, init: RequestInit = {}) {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  if (!apiKey) throw new Error('lemonsqueezy_not_configured');
  const response = await fetch(`https://api.lemonsqueezy.com/v1${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${apiKey}`,
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`lemonsqueezy_api_${response.status}`);
  return response.json() as Promise<unknown>;
}

export async function createCheckout(input: {
  userId: string;
  email: string;
  name: string;
  tier: PaidApiTier;
}): Promise<string> {
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  const variantId = variantForTier(input.tier);
  if (!storeId || !variantId || !/^\d+$/.test(storeId) || !/^\d+$/.test(variantId)) {
    throw new Error('lemonsqueezy_not_configured');
  }
  const payload = await lemonRequest('/checkouts', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: {
            email: input.email,
            name: input.name,
            custom: { user_id: input.userId, api_tier: input.tier },
          },
          product_options: { enabled_variants: [Number(variantId)] },
        },
        relationships: {
          store: { data: { type: 'stores', id: storeId } },
          variant: { data: { type: 'variants', id: variantId } },
        },
      },
    }),
  });
  return z
    .object({ data: z.object({ attributes: z.object({ url: z.string().url() }) }) })
    .parse(payload).data.attributes.url;
}

export async function customerPortalUrl(subscriptionId: string): Promise<string> {
  const payload = await lemonRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
  const parsed = z
    .object({ data: z.object({ attributes: subscriptionAttributes }) })
    .parse(payload);
  const url = parsed.data.attributes.urls?.customer_portal;
  if (!url) throw new Error('customer_portal_unavailable');
  return url;
}
