import { describe, expect, test } from 'bun:test';
import { computeHmacSha256Hex } from './hmac';
import { entitledTier, lemonEventId, tierForVariant, verifyLemonSignature } from './lemonsqueezy';

process.env.LEMONSQUEEZY_DEV_VARIANT_ID = '100';
process.env.LEMONSQUEEZY_PRO_VARIANT_ID = '200';

describe('Lemon Squeezy billing primitives (SFM-44)', () => {
  test('verifies the raw-body X-Signature and derives stable replay ids', () => {
    const raw = '{"event":"subscription_updated"}';
    const signature = computeHmacSha256Hex(raw, 'secret');
    expect(verifyLemonSignature(raw, signature, 'secret')).toBe(true);
    expect(verifyLemonSignature(`${raw} `, signature, 'secret')).toBe(false);
    expect(lemonEventId(raw)).toBe(lemonEventId(raw));
  });

  test('maps configured variants and only grants current paid entitlements', () => {
    expect(tierForVariant('100')).toBe('dev');
    expect(tierForVariant('200')).toBe('pro');
    expect(entitledTier('200', 'active', null)).toBe('pro');
    expect(entitledTier('100', 'cancelled', new Date(Date.now() + 60_000))).toBe('dev');
    expect(entitledTier('100', 'cancelled', new Date(Date.now() - 60_000))).toBe('free');
    expect(entitledTier('200', 'expired', null)).toBe('free');
    expect(entitledTier('999', 'active', null)).toBe('free');
  });
});
