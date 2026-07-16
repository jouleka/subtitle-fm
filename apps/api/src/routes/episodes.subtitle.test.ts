import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { db } from '../lib/db';
import { schema } from '@subtitle-fm/db';
import { eq } from 'drizzle-orm';

const presignGetMock = mock(
  async ({ key }: { bucket: string; key: string }) => `https://r2.example/presigned/${key}`,
);
mock.module('../lib/r2', () => ({
  presignGet: presignGetMock,
  putObject: mock(async () => {}),
  presignPut: mock(async () => ''),
  deleteObject: mock(async () => {}),
  R2_BUCKETS: {},
}));
mock.module('../lib/queue', () => ({
  preprocessQueue: { add: mock(async () => ({})) },
  transcribeQueue: { add: mock(async () => ({})) },
  translateQueue: { add: mock(async () => ({})) },
  publishQueue: { add: mock(async () => ({})) },
  connection: {},
}));
const { app } = await import('../index');

const SHOW = 'sfm59sub-show';
const EP_PUB = '59999999-1111-0000-0000-000000000001';
const EP_UNPUB = '59999999-1111-0000-0000-000000000002';

beforeAll(async () => {
  await db.delete(schema.episodes).where(eq(schema.episodes.showId, SHOW));
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW));
  await db.insert(schema.shows).values({ id: SHOW, title: 'SFM-59 sub', slug: 'sfm-59-sub' });
  await db.insert(schema.episodes).values({
    id: EP_PUB,
    showId: SHOW,
    number: 1,
    title: 'p',
    status: 'published',
    peaksUrl: `https://api.example/episodes/${EP_PUB}/peaks.dat`,
  });
  await db
    .insert(schema.episodes)
    .values({ id: EP_UNPUB, showId: SHOW, number: 2, title: 'u', status: 'ready_for_edit' });
});
afterAll(async () => {
  await db.delete(schema.episodes).where(eq(schema.episodes.showId, SHOW));
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW));
});

describe('GET /episodes/:id/subtitle.ass', () => {
  test('302-redirects a published episode to the canonical ASS artifact', async () => {
    const res = await app.request(`/episodes/${EP_PUB}/subtitle.ass`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      `https://r2.example/presigned/subtitles/${EP_PUB}/published.ass`,
    );
    expect(presignGetMock).toHaveBeenLastCalledWith({
      bucket: 'media',
      key: `subtitles/${EP_PUB}/published.ass`,
      responseContentType: 'text/plain; charset=utf-8',
      responseContentDisposition: `attachment; filename="${EP_PUB}.ass"`,
    });
  });

  test('404 not_published for an unpublished episode', async () => {
    const res = await app.request(`/episodes/${EP_UNPUB}/subtitle.ass`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('not_published');
  });

  test('404 episode_not_found for an unknown id', async () => {
    const res = await app.request(`/episodes/00000000-0000-0000-0000-0000000000ff/subtitle.ass`);
    expect(res.status).toBe(404);
  });
});

describe('GET /episodes/:id/subtitle.srt', () => {
  test('302-redirects a published episode to the presigned R2 url', async () => {
    const res = await app.request(`/episodes/${EP_PUB}/subtitle.srt`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      `https://r2.example/presigned/subtitles/${EP_PUB}/published.srt`,
    );
    expect(presignGetMock).toHaveBeenLastCalledWith({
      bucket: 'media',
      key: `subtitles/${EP_PUB}/published.srt`,
      responseContentType: 'application/x-subrip; charset=utf-8',
      responseContentDisposition: `attachment; filename="${EP_PUB}.srt"`,
    });
  });
  test('404 not_published for an unpublished episode', async () => {
    const res = await app.request(`/episodes/${EP_UNPUB}/subtitle.srt`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('not_published');
  });
  test('404 episode_not_found for an unknown id', async () => {
    const res = await app.request(`/episodes/00000000-0000-0000-0000-0000000000ff/subtitle.srt`);
    expect(res.status).toBe(404);
  });
});

describe('GET /episodes/:id/subtitle.vtt', () => {
  test('302-redirects a published episode to the presigned .vtt R2 url', async () => {
    const res = await app.request(`/episodes/${EP_PUB}/subtitle.vtt`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      `https://r2.example/presigned/subtitles/${EP_PUB}/published.vtt`,
    );
    expect(presignGetMock).toHaveBeenLastCalledWith({
      bucket: 'media',
      key: `subtitles/${EP_PUB}/published.vtt`,
      responseContentType: 'text/vtt; charset=utf-8',
      responseContentDisposition: `attachment; filename="${EP_PUB}.vtt"`,
    });
  });
  test('404 not_published for an unpublished episode', async () => {
    const res = await app.request(`/episodes/${EP_UNPUB}/subtitle.vtt`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('not_published');
  });
  test('404 episode_not_found for an unknown id', async () => {
    const res = await app.request(`/episodes/00000000-0000-0000-0000-0000000000ff/subtitle.vtt`);
    expect(res.status).toBe(404);
  });
});

describe('GET /episodes/:id/peaks.dat', () => {
  test('302-redirects a ready waveform through the private peaks bucket', async () => {
    const res = await app.request(`/episodes/${EP_PUB}/peaks.dat`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`https://r2.example/presigned/${EP_PUB}.dat`);
    expect(presignGetMock).toHaveBeenLastCalledWith({
      bucket: 'peaks',
      key: `${EP_PUB}.dat`,
    });
  });

  test('404 waveform_not_ready before preprocessing completes', async () => {
    const res = await app.request(`/episodes/${EP_UNPUB}/peaks.dat`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('waveform_not_ready');
  });

  test('404 episode_not_found for an unknown id', async () => {
    const res = await app.request('/episodes/00000000-0000-0000-0000-0000000000ff/peaks.dat');
    expect(res.status).toBe(404);
  });
});
