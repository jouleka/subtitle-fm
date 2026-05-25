import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { presignPut, presignGet, R2_BUCKETS } from '../lib/r2';
import {
  generateSourceKey,
  extForContentType,
  MAX_UPLOAD_BYTES,
  SOURCE_CONTENT_TYPES,
  UnsupportedContentTypeError,
} from '../lib/uploads';
import { log } from '../lib/log';

const PUT_EXPIRES_SEC = 15 * 60;
/**
 * 7 days — SigV4 max. The GET URL is handed to a BullMQ-driven pipeline with
 * retries; the queue can sit for a long time if a downstream stage is wedged.
 * Worker code should re-presign from { bucket, key } if it ever needs longer.
 */
const GET_EXPIRES_SEC = 7 * 24 * 60 * 60;

const createUploadSchema = z.object({
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES).optional(),
});

export const uploads = new Hono()
  /**
   * Surface allowed types so the editor can validate client-side before a
   * round-trip. No auth needed — this is metadata, not state.
   */
  .get('/source/allowed', (c) =>
    c.json({
      contentTypes: Object.keys(SOURCE_CONTENT_TYPES),
      maxBytes: MAX_UPLOAD_BYTES,
    }),
  )
  /**
   * Request a presigned PUT URL for a source-media upload. Caller PUTs the
   * file directly to R2 (bypassing the api), then references the returned
   * { bucket, key } when creating an episode.
   *
   * Returns:
   *  - uploadUrl: presigned PUT (15 min)
   *  - getUrl:    presigned GET (24 hr) — usable as POST /episodes sourceUrl
   *  - bucket/key: canonical R2 location, for downstream worker fetches
   */
  .post('/source', zValidator('json', createUploadSchema), async (c) => {
    const input = c.req.valid('json');
    let ext: string;
    try {
      ext = extForContentType(input.contentType);
    } catch (e) {
      if (e instanceof UnsupportedContentTypeError) {
        return c.json(
          { error: 'unsupported_content_type', contentType: input.contentType },
          415,
        );
      }
      throw e;
    }

    const key = generateSourceKey(input.contentType);
    // We presign GET alongside PUT to save the common-case round trip:
    // the caller's next step is almost always POST /episodes with this URL
    // as sourceUrl. If we ever gate uploads behind auth, this is also where
    // we'd authorize the GET on the caller, not just the file's existence.
    const [uploadUrl, getUrl] = await Promise.all([
      presignPut({ bucket: 'media', key, expiresInSec: PUT_EXPIRES_SEC }),
      presignGet({ bucket: 'media', key, expiresInSec: GET_EXPIRES_SEC }),
    ]);

    log.info({ key, ext, sizeBytes: input.sizeBytes }, 'uploads.source.presigned');

    return c.json({
      bucket: R2_BUCKETS.media(),
      key,
      uploadUrl,
      uploadExpiresInSec: PUT_EXPIRES_SEC,
      getUrl,
      getExpiresInSec: GET_EXPIRES_SEC,
    });
  });
