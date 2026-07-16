import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { db } from './db';
import { schema } from '@subtitle-fm/db';
import { eq, inArray } from 'drizzle-orm';

// ingest.ts imports "./queue" (real BullMQ → Redis at load). Mock it so these
// tests exercise the real DB without Redis and can assert what got enqueued.
const addMock = mock(async () => ({}));
mock.module('./queue', () => ({
  preprocessQueue: { add: addMock },
  transcribeQueue: { add: mock(async () => ({})) },
  translateQueue: { add: mock(async () => ({})) },
  publishQueue: { add: mock(async () => ({})) },
  connection: {},
}));

const { ensureShow, importCatalog, ShowConflictError } = await import('./ingest');

const SHOW_IDS = ['cat-a', 'cat-b', 'cat-c', 'cat-slug-owner', 'cat-slug-new'];
async function cleanup() {
  await db.delete(schema.episodes).where(inArray(schema.episodes.showId, SHOW_IDS));
  await db.delete(schema.shows).where(inArray(schema.shows.id, SHOW_IDS));
}
const epList = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    seasonNumber: 1,
    number: i + 1,
    sourceUrl: `https://ex.com/${i + 1}.mp4`,
    sourceLanguage: 'ja',
    targetLanguage: 'en',
  }));

beforeAll(cleanup);
afterAll(cleanup);
beforeEach(async () => {
  addMock.mockReset();
  addMock.mockImplementation(async () => ({}));
  await cleanup();
});

describe('ensureShow', () => {
  test('creates a missing show', async () => {
    const r = await ensureShow({ id: 'cat-a', title: 'A', slug: 'cat-a' });
    expect(r.status).toBe('created');
    const [row] = await db
      .select({ id: schema.shows.id })
      .from(schema.shows)
      .where(eq(schema.shows.id, 'cat-a'))
      .limit(1);
    expect(row!.id).toBe('cat-a');
  });

  test('returns exists for an existing id and does NOT update it (intent: v1 is create-if-missing, never overwrite)', async () => {
    await db.insert(schema.shows).values({ id: 'cat-a', title: 'Original', slug: 'cat-a' });
    const r = await ensureShow({ id: 'cat-a', title: 'Changed', slug: 'cat-a' });
    expect(r.status).toBe('exists');
    const [row] = await db
      .select({ title: schema.shows.title })
      .from(schema.shows)
      .where(eq(schema.shows.id, 'cat-a'))
      .limit(1);
    expect(row!.title).toBe('Original');
  });

  test('throws ShowConflictError on a slug collision with a new id (intent: a clear operator error, not a raw 23505)', async () => {
    await db
      .insert(schema.shows)
      .values({ id: 'cat-slug-owner', title: 'Owner', slug: 'shared-slug' });
    let err: unknown;
    try {
      await ensureShow({ id: 'cat-slug-new', title: 'Y', slug: 'shared-slug' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ShowConflictError);
  });
});

describe('importCatalog', () => {
  test('creates shows + episodes and enqueues one job per created episode', async () => {
    const res = await importCatalog([
      { id: 'cat-a', title: 'A', slug: 'cat-a', episodes: epList(2) },
    ]);
    expect(res[0]!.show).toBe('created');
    expect(res[0]!.created.length).toBe(2);
    expect(res[0]!.skipped.length).toBe(0);
    expect(res[0]!.failed.length).toBe(0);
    expect(addMock).toHaveBeenCalledTimes(2);
    const rows = await db
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .where(eq(schema.episodes.showId, 'cat-a'));
    expect(rows.length).toBe(2);
  });

  test('a second run is idempotent: show exists, episodes skipped, nothing re-enqueued', async () => {
    const shows = [{ id: 'cat-a', title: 'A', slug: 'cat-a', episodes: epList(2) }];
    await importCatalog(shows);
    addMock.mockReset();
    addMock.mockImplementation(async () => ({}));
    const res = await importCatalog(shows);
    expect(res[0]!.show).toBe('exists');
    expect(res[0]!.created.length).toBe(0);
    expect(res[0]!.skipped.length).toBe(2);
    expect(addMock).toHaveBeenCalledTimes(0);
  });

  test('allows the same episode number in two seasons', async () => {
    const episodes = [
      { ...epList(1)[0]!, seasonNumber: 1 },
      { ...epList(1)[0]!, seasonNumber: 2, sourceUrl: 'https://ex.com/s2e1.mp4' },
    ];
    const res = await importCatalog([{ id: 'cat-a', title: 'A', slug: 'cat-a', episodes }]);
    expect(res[0]!.created.map((e) => [e.seasonNumber, e.number])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(addMock).toHaveBeenCalledTimes(2);
  });

  test('isolates a failing show: A succeeds, B fails (slug collision), C still succeeds (intent: one bad show never aborts the batch)', async () => {
    await db
      .insert(schema.shows)
      .values({ id: 'cat-slug-owner', title: 'Owner', slug: 'taken-slug' });
    const res = await importCatalog([
      { id: 'cat-a', title: 'A', slug: 'cat-a', episodes: epList(1) },
      { id: 'cat-b', title: 'B', slug: 'taken-slug', episodes: epList(1) },
      { id: 'cat-c', title: 'C', slug: 'cat-c', episodes: epList(1) },
    ]);
    expect(res[0]!.show).toBe('created');
    expect(res[0]!.created.length).toBe(1);
    expect(res[1]!.show).toBe('error');
    expect(res[1]!.showError).toBeTruthy();
    expect(res[1]!.created.length).toBe(0);
    expect(res[2]!.show).toBe('created');
    expect(res[2]!.created.length).toBe(1);
  });

  test("records an episode as failed but keeps going when its enqueue fails (intent: the CLI's exit-code-1 path)", async () => {
    addMock.mockRejectedValueOnce(new Error('redis down')); // first enqueue (ep 1) fails
    const res = await importCatalog([
      { id: 'cat-a', title: 'A', slug: 'cat-a', episodes: epList(2) },
    ]);
    expect(res[0]!.show).toBe('created');
    expect(res[0]!.failed.map((f) => f.number)).toEqual([1]);
    expect(res[0]!.created.map((c) => c.number)).toEqual([2]); // the next episode still ingests
    // compensating delete ran: only ep 2's row remains
    const rows = await db
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .where(eq(schema.episodes.showId, 'cat-a'));
    expect(rows.length).toBe(1);
  });
});
