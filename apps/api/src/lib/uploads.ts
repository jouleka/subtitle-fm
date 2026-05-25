/**
 * Pure helpers for the upload flow: content-type allowlist and object key
 * generation. Kept dependency-free so they're trivial to unit-test without
 * touching AWS SDK / network.
 */

/**
 * Allowed source-media MIME types → canonical file extension. Anything not
 * in this map is rejected at the presign step.
 */
export const SOURCE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  'video/mp4': 'mp4',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/ogg': 'ogg',
};

/** Max single-PUT upload size in bytes. R2 single-PUT limit is 5GB. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

export class UnsupportedContentTypeError extends Error {
  constructor(contentType: string) {
    super(`unsupported content type: ${contentType}`);
    this.name = 'UnsupportedContentTypeError';
  }
}

export function extForContentType(contentType: string): string {
  const ext = SOURCE_CONTENT_TYPES[contentType.toLowerCase()];
  if (!ext) throw new UnsupportedContentTypeError(contentType);
  return ext;
}

/**
 * Generate an R2 object key for an anonymous user upload. The key is
 * collision-resistant (UUID v4) and includes the canonical extension so
 * the worker can detect the format from the key alone.
 */
export function generateSourceKey(contentType: string): string {
  const ext = extForContentType(contentType);
  const id = crypto.randomUUID();
  return `uploads/${id}.${ext}`;
}
