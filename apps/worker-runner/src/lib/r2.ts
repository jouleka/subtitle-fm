import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

type BucketName = 'media' | 'peaks';

const bucketNames: Record<BucketName, () => string> = {
  media: () => process.env.R2_BUCKET_MEDIA ?? 'subtitle-fm-media',
  peaks: () => process.env.R2_BUCKET_PEAKS ?? 'subtitle-fm-peaks',
};

let cached: S3Client | undefined;

function client(): S3Client {
  if (cached) return cached;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 not configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY');
  }
  cached = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cached;
}

export async function putObject(
  bucket: BucketName,
  key: string,
  body: string | Uint8Array,
  contentType?: string,
): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: bucketNames[bucket](),
      Key: key,
      Body: body,
      ...(contentType ? { ContentType: contentType } : {}),
    }),
  );
}

export async function deleteObject(bucket: BucketName, key: string): Promise<void> {
  await client().send(
    new DeleteObjectCommand({
      Bucket: bucketNames[bucket](),
      Key: key,
    }),
  );
}
