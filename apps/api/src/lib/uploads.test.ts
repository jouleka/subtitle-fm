import { describe, expect, test } from 'bun:test';
import {
  extForContentType,
  generateSourceKey,
  MAX_UPLOAD_BYTES,
  ownedSourceKeyFromUrl,
  SOURCE_CONTENT_TYPES,
  UnsupportedContentTypeError,
} from './uploads';

describe('extForContentType', () => {
  test('maps known video types to canonical extensions', () => {
    expect(extForContentType('video/mp4')).toBe('mp4');
    expect(extForContentType('video/x-matroska')).toBe('mkv');
    expect(extForContentType('video/webm')).toBe('webm');
    expect(extForContentType('video/quicktime')).toBe('mov');
  });

  test('maps known audio types', () => {
    expect(extForContentType('audio/mpeg')).toBe('mp3');
    expect(extForContentType('audio/wav')).toBe('wav');
    expect(extForContentType('audio/flac')).toBe('flac');
    expect(extForContentType('audio/x-flac')).toBe('flac');
  });

  test('is case-insensitive on input (Content-Type headers vary)', () => {
    expect(extForContentType('VIDEO/MP4')).toBe('mp4');
    expect(extForContentType('Video/Mp4')).toBe('mp4');
  });

  test('throws UnsupportedContentTypeError on unknown types (no silent fallback)', () => {
    expect(() => extForContentType('application/pdf')).toThrow(UnsupportedContentTypeError);
    expect(() => extForContentType('video/x-unknown')).toThrow(UnsupportedContentTypeError);
    expect(() => extForContentType('')).toThrow(UnsupportedContentTypeError);
  });

  test('error carries the offending content type for caller logging', () => {
    try {
      extForContentType('application/zip');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedContentTypeError);
      expect((e as Error).message).toContain('application/zip');
    }
  });
});

describe('ownedSourceKeyFromUrl', () => {
  test('extracts only application-owned upload keys from R2 presigned URLs', () => {
    const key = 'uploads/11111111-1111-4111-8111-111111111111.mkv';
    expect(
      ownedSourceKeyFromUrl(
        `https://subtitle-fm-media.account.r2.cloudflarestorage.com/${key}?X-Amz-Signature=x`,
      ),
    ).toBe(key);
  });

  test('refuses external URLs and malformed upload paths (intent: cleanup never deletes unowned media)', () => {
    expect(ownedSourceKeyFromUrl('https://example.com/uploads/video.mkv')).toBeNull();
    expect(
      ownedSourceKeyFromUrl('https://account.r2.cloudflarestorage.com/uploads/../../published.ass'),
    ).toBeNull();
    expect(
      ownedSourceKeyFromUrl('https://account.r2.cloudflarestorage.com/uploads/%zz.mkv'),
    ).toBeNull();
  });
});

describe('generateSourceKey', () => {
  test('produces uploads/<uuid>.<ext> shape', () => {
    const key = generateSourceKey('video/mp4');
    expect(key).toMatch(
      /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/,
    );
  });

  test('keys are unique across calls (UUID v4 collision resistance)', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateSourceKey('video/mp4')));
    expect(keys.size).toBe(50);
  });

  test('extension reflects the content type', () => {
    expect(generateSourceKey('video/webm')).toMatch(/\.webm$/);
    expect(generateSourceKey('audio/flac')).toMatch(/\.flac$/);
  });

  test('rejects unsupported content types at key-generation time (fail loud)', () => {
    expect(() => generateSourceKey('text/plain')).toThrow(UnsupportedContentTypeError);
  });

  test('no path traversal possible from content-type input', () => {
    // Even if a future addition to SOURCE_CONTENT_TYPES had a malicious value,
    // the key shape is fixed by the function. This test pins the prefix and
    // confirms no extra slashes leak into the suffix.
    const key = generateSourceKey('video/mp4');
    expect(key.startsWith('uploads/')).toBe(true);
    expect(key).not.toContain('..');
    const suffix = key.slice('uploads/'.length);
    expect(suffix).not.toContain('/');
  });
});

describe('limits', () => {
  test('MAX_UPLOAD_BYTES is 5GB (R2 single-PUT ceiling)', () => {
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024 * 1024);
  });

  test('SOURCE_CONTENT_TYPES covers the codecs most anime releases use', () => {
    expect(SOURCE_CONTENT_TYPES['video/mp4']).toBeDefined();
    expect(SOURCE_CONTENT_TYPES['video/x-matroska']).toBeDefined();
  });
});
