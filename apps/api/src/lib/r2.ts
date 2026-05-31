import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Bucket map. Names are lazy-resolved so missing env vars don't crash on
 * module load (matters for tests + the local dev path that may not have
 * R2 configured).
 */
/**
 * Bucket map. `peaks` is pre-declared (unused in this slice) so the next
 * waveform-pipeline slice — SFM-23 — doesn't have to relitigate the
 * structure. Matches the R2_BUCKET_* env vars in .env.example.
 */
export const R2_BUCKETS = {
  media: () => process.env.R2_BUCKET_MEDIA ?? 'subtitle-fm-media',
  peaks: () => process.env.R2_BUCKET_PEAKS ?? 'subtitle-fm-peaks',
} as const;

export type R2BucketName = keyof typeof R2_BUCKETS;

let cached: S3Client | undefined;

function getClient(): S3Client {
  if (cached) return cached;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2 not configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY',
    );
  }
  cached = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cached;
}

interface PresignOpts {
  bucket: R2BucketName;
  key: string;
  /** SigV4 max is 604800 (7 days). Values above will throw at runtime. */
  expiresInSec?: number;
}

/**
 * Generate a presigned PUT URL the browser can upload to directly.
 * Default expiry: 15 minutes (enough for slow connections on large files,
 * short enough that a leaked URL has limited blast radius).
 *
 * Note: we deliberately do NOT bind `Content-Type` into the signature. R2
 * (like S3) would then require the uploader to send a byte-identical
 * Content-Type header, which browsers and `fetch(..., { body: file })`
 * routinely get wrong (empty string, octet-stream, parameter drift). The
 * canonical extension lives in the key, so type detection on the worker
 * side can still happen via ffprobe on the actual bytes.
 */
export async function presignPut(opts: PresignOpts): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: R2_BUCKETS[opts.bucket](),
    Key: opts.key,
  });
  return getSignedUrl(getClient(), cmd, { expiresIn: opts.expiresInSec ?? 900 });
}

/**
 * Generate a presigned GET URL for an existing object. Used to hand the
 * Python worker a fetchable URL without sharing R2 credentials directly.
 * Default expiry: 1 hour.
 *
 * For retry-prone callers (BullMQ workers with `attempts: 3` and exponential
 * backoff), prefer re-presigning from `{ bucket, key }` at dequeue time
 * rather than passing a baked URL through the queue. SigV4 caps expiry at
 * 7 days regardless.
 */
export async function presignGet(opts: PresignOpts): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: R2_BUCKETS[opts.bucket](),
    Key: opts.key,
  });
  return getSignedUrl(getClient(), cmd, { expiresIn: opts.expiresInSec ?? 3600 });
}

/**
 * Hard-delete an R2 object. Use sparingly — the `media` bucket should have
 * a 24-hour lifecycle rule configured in the Cloudflare dashboard that
 * makes most deletions automatic. This is for the explicit-cleanup path.
 */
export async function deleteObject(bucket: R2BucketName, key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKETS[bucket](),
      Key: key,
    }),
  );
}

/**
 * Upload bytes/string directly to R2 (server-side; the published .ass is small).
 * Distinct from presignPut, which hands the browser a URL to upload to itself.
 */
export async function putObject(
  bucket: R2BucketName,
  key: string,
  body: string | Uint8Array,
  contentType?: string,
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: R2_BUCKETS[bucket](),
      Key: key,
      Body: body,
      ...(contentType ? { ContentType: contentType } : {}),
    }),
  );
}
