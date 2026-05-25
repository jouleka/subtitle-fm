import { createHmac, timingSafeEqual } from 'node:crypto';

const HEX_RE = /^[0-9a-f]+$/i;

/**
 * Compute the lowercase-hex HMAC-SHA256 of a payload with the given secret.
 * Matches the GitHub-style `sha256=<hex>` header convention.
 */
export function computeHmacSha256Hex(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Constant-time verification of a `sha256=<hex>` style signature. Accepts
 * both `sha256=<hex>` and bare `<hex>` forms.
 *
 * Returns false (never throws) on any malformed input so callers can treat
 * verification as a boolean. We explicitly hex-validate before decoding
 * because Node's `Buffer.from(..., 'hex')` silently returns an empty buffer
 * on non-hex chars rather than throwing (nodejs/node#24722).
 */
export function verifyHmacSha256(body: string, provided: string, secret: string): boolean {
  if (!provided || !secret) return false;

  const providedHex = provided.startsWith('sha256=') ? provided.slice(7) : provided;
  if (!HEX_RE.test(providedHex)) return false;

  const expectedHex = computeHmacSha256Hex(body, secret);
  if (providedHex.length !== expectedHex.length) return false;

  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const providedBuf = Buffer.from(providedHex, 'hex');
  // Hex regex + length check above guarantee identical byte lengths,
  // so timingSafeEqual cannot throw on length mismatch here.
  return timingSafeEqual(expectedBuf, providedBuf);
}
