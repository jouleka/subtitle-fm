import { describe, expect, test } from 'bun:test';
import { computeHmacSha256Hex, verifyHmacSha256 } from './hmac';

const SECRET = 'test-secret-do-not-use-in-prod';
const BODY = '{"eventId":"abc","episodeId":"a3f4"}';

describe('computeHmacSha256Hex', () => {
  test('produces a 64-character lowercase hex digest', () => {
    const sig = computeHmacSha256Hex(BODY, SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  test('is deterministic for the same inputs', () => {
    expect(computeHmacSha256Hex(BODY, SECRET)).toBe(computeHmacSha256Hex(BODY, SECRET));
  });

  test('differs if body changes by one byte (intent: tampering is detected)', () => {
    const a = computeHmacSha256Hex(BODY, SECRET);
    const b = computeHmacSha256Hex(BODY + ' ', SECRET);
    expect(a).not.toBe(b);
  });

  test('differs if secret changes (intent: rotated secrets invalidate old signatures)', () => {
    expect(computeHmacSha256Hex(BODY, SECRET)).not.toBe(
      computeHmacSha256Hex(BODY, SECRET + 'x'),
    );
  });
});

describe('verifyHmacSha256', () => {
  test('accepts a valid signature in sha256=<hex> form', () => {
    const sig = `sha256=${computeHmacSha256Hex(BODY, SECRET)}`;
    expect(verifyHmacSha256(BODY, sig, SECRET)).toBe(true);
  });

  test('accepts a valid signature in bare hex form', () => {
    const sig = computeHmacSha256Hex(BODY, SECRET);
    expect(verifyHmacSha256(BODY, sig, SECRET)).toBe(true);
  });

  test('rejects a tampered body', () => {
    const sig = computeHmacSha256Hex(BODY, SECRET);
    expect(verifyHmacSha256(BODY + 'x', sig, SECRET)).toBe(false);
  });

  test('rejects a signature computed with the wrong secret', () => {
    const sig = computeHmacSha256Hex(BODY, 'other-secret');
    expect(verifyHmacSha256(BODY, sig, SECRET)).toBe(false);
  });

  test('rejects empty signature', () => {
    expect(verifyHmacSha256(BODY, '', SECRET)).toBe(false);
  });

  test('rejects empty secret (avoid accidental allow-all)', () => {
    expect(verifyHmacSha256(BODY, 'sha256=00', '')).toBe(false);
  });

  test('rejects signature of wrong length without throwing', () => {
    expect(verifyHmacSha256(BODY, 'sha256=tooshort', SECRET)).toBe(false);
  });

  test('rejects non-hex signature via the hex regex (not via decode silently emptying)', () => {
    // length matches a real digest but contents are non-hex.
    // Without the regex pre-check this would pass via Buffer.from quietly
    // returning an empty buffer, then the length check rejecting empty vs 32.
    // The regex catches it earlier and more honestly.
    const fakeSig = 'sha256=' + 'z'.repeat(64);
    expect(verifyHmacSha256(BODY, fakeSig, SECRET)).toBe(false);
  });

  test('rejects partial-hex (mixed valid + invalid chars)', () => {
    const validHex = computeHmacSha256Hex(BODY, SECRET);
    const corrupted = 'sha256=' + 'X' + validHex.slice(1);
    expect(verifyHmacSha256(BODY, corrupted, SECRET)).toBe(false);
  });
});
