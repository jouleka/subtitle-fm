import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { schema } from '@subtitle-fm/db';
import { hydrateCuesIntoDoc, type CueSeed } from '@subtitle-fm/shared/yjs';
import type { PublishJob } from '@subtitle-fm/shared';
import { db } from '../lib/db';

const SHOW_ID = 'test-show-sfm57-publish';
const EPISODE_ID = '57575757-5757-4757-8757-575757575701';
const BAD_EPISODE_ID = '57575757-5757-4757-8757-575757575702';
const SNAPSHOT_ID = '57575757-5757-4757-8757-575757575711';
const BAD_SNAPSHOT_ID = '57575757-5757-4757-8757-575757575712';

const putObjectMock = mock(async () => {});
const deleteObjectMock = mock(async () => {});
const enqueueMock = mock(async () => {});

mock.module('../lib/r2', () => ({
  putObject: putObjectMock,
  deleteObject: deleteObjectMock,
}));
mock.module('../lib/dispatch', () => ({
  enqueue: enqueueMock,
  closeDispatch: mock(async () => {}),
}));

const { handlePublish } = await import('./publish');
const { handleCleanupMedia } = await import('./cleanup-media');

function stateFor(text: string): Uint8Array {
  const cues: CueSeed[] = [
    {
      id: crypto.randomUUID(),
      orderIndex: 0,
      startMs: 0,
      endMs: 1_000,
      text,
      styleName: 'Default',
      speakerId: null,
      confidence: 0.9,
      needsReview: false,
    },
  ];
  const doc = new Y.Doc();
  hydrateCuesIntoDoc(doc, cues);
  return Y.encodeStateAsUpdate(doc);
}

function publishJob(episodeId: string, snapshotId: string, attemptsMade = 0): Job<PublishJob> {
  return {
    id: `publish-${snapshotId}`,
    data: {
      episodeId,
      pipelineRunId: crypto.randomUUID(),
      snapshotId,
      formats: ['ass', 'srt', 'vtt'],
    },
    attemptsMade,
    opts: { attempts: 3 },
  } as unknown as Job<PublishJob>;
}

async function cleanupFixtures() {
  for (const id of [EPISODE_ID, BAD_EPISODE_ID]) {
    await db.delete(schema.snapshots).where(eq(schema.snapshots.episodeId, id));
    await db.delete(schema.episodes).where(eq(schema.episodes.id, id));
  }
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW_ID));
}

beforeAll(async () => {
  await cleanupFixtures();
  await db.insert(schema.shows).values({
    id: SHOW_ID,
    title: 'SFM-57 Publish Worker',
    slug: 'sfm-57-publish-worker',
  });
  await db.insert(schema.episodes).values([
    {
      id: EPISODE_ID,
      showId: SHOW_ID,
      number: 1,
      status: 'publishing',
      sourceKey: 'uploads/11111111-1111-4111-8111-111111111111.mkv',
    },
    { id: BAD_EPISODE_ID, showId: SHOW_ID, number: 2, status: 'publishing' },
  ]);
  await db.insert(schema.snapshots).values([
    {
      id: SNAPSHOT_ID,
      episodeId: EPISODE_ID,
      label: 'published-good',
      yjsState: stateFor('hello'),
    },
    {
      id: BAD_SNAPSHOT_ID,
      episodeId: BAD_EPISODE_ID,
      label: 'published-bad',
      yjsState: stateFor('bad\ntext'),
    },
  ]);
});

afterAll(cleanupFixtures);

beforeEach(() => {
  putObjectMock.mockReset();
  putObjectMock.mockImplementation(async () => {});
  deleteObjectMock.mockReset();
  deleteObjectMock.mockImplementation(async () => {});
  enqueueMock.mockReset();
  enqueueMock.mockImplementation(async () => {});
});

describe('publish worker', () => {
  test('renders the frozen snapshot, uploads all formats, and schedules 24h cleanup before publishing', async () => {
    await handlePublish(publishJob(EPISODE_ID, SNAPSHOT_ID));

    expect(putObjectMock).toHaveBeenCalledTimes(3);
    const uploads = Object.fromEntries(
      (putObjectMock.mock.calls as unknown[][]).map((call) => [
        call[1] as string,
        { body: call[2] as string, contentType: call[3] as string },
      ]),
    );
    const base = `subtitles/${EPISODE_ID}/published`;
    expect(uploads[`${base}.ass`]!.body).toContain('[Events]');
    expect(uploads[`${base}.srt`]!.body.startsWith('1\n')).toBe(true);
    expect(uploads[`${base}.vtt`]!.body.startsWith('WEBVTT')).toBe(true);

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const cleanupCalls = enqueueMock.mock.calls as unknown as Array<
      [string, { objects: unknown[] }, string, number]
    >;
    expect(cleanupCalls[0]![0]).toBe('cleanup-media');
    expect(cleanupCalls[0]![1].objects).toHaveLength(3);
    expect(cleanupCalls[0]![2]).toBe(`cleanup-${SNAPSHOT_ID}`);
    expect(cleanupCalls[0]![3]).toBe(24 * 60 * 60 * 1000);

    const [episode] = await db
      .select({ status: schema.episodes.status })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, EPISODE_ID))
      .limit(1);
    expect(episode!.status).toBe('published');
  });

  test('marks a permanently invalid snapshot failed only on the final retry', async () => {
    await expect(handlePublish(publishJob(BAD_EPISODE_ID, BAD_SNAPSHOT_ID, 2))).rejects.toThrow();
    expect(putObjectMock).toHaveBeenCalledTimes(0);
    expect(enqueueMock).toHaveBeenCalledTimes(0);

    const [episode] = await db
      .select({ status: schema.episodes.status })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, BAD_EPISODE_ID))
      .limit(1);
    expect(episode!.status).toBe('failed');
  });
});

describe('cleanup worker', () => {
  test('deletes every scheduled object idempotently', async () => {
    await handleCleanupMedia({
      id: 'cleanup-test',
      data: {
        episodeId: EPISODE_ID,
        objects: [
          { bucket: 'media', key: `stage/preprocess/${EPISODE_ID}.wav` },
          { bucket: 'media', key: `stage/transcribe/${EPISODE_ID}.json` },
        ],
      },
    } as unknown as Job<import('@subtitle-fm/shared').CleanupMediaJob>);

    expect(deleteObjectMock).toHaveBeenCalledTimes(2);
  });
});
