import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { db } from "../lib/db";
import { schema } from "@subtitle-fm/db";
import { and, eq, inArray } from "drizzle-orm";
import * as authModule from "../lib/auth";

const SHOW = "test-show-create";
const NOSHOW = "test-show-create-missing";
const SRC = "https://example.com/video.mp4";
const FAKE_USER = { id: "66666666-0000-0000-0000-000000000001", handle: "create-test", email: "create@example.com" };
const FAKE_SESSION = { id: "66666666-0000-0000-0000-000000000002", userId: FAKE_USER.id, token: "tok-create", expiresAt: new Date(Date.now() + 24 * 3600 * 1000) };

const mockGetSession = mock();
const authed = () => mockGetSession.mockResolvedValueOnce({ user: FAKE_USER, session: FAKE_SESSION });
const anon = () => mockGetSession.mockResolvedValueOnce(null);

// The producer queue is a real BullMQ instance (connects to Redis at import).
// Mock the whole module so route tests can drive the create/enqueue path
// without Redis, and assert what got enqueued.
const addMock = mock(async () => ({}));
mock.module("../lib/queue", () => ({
  preprocessQueue: { add: addMock },
  transcribeQueue: { add: mock(async () => ({})) },
  translateQueue: { add: mock(async () => ({})) },
  publishQueue: { add: mock(async () => ({})) },
  connection: {},
}));

// Dynamic import AFTER mock.module so the mocked queue is loaded.
const { app } = await import("../index");

function postJson(path: string, body: unknown) {
  return app.request(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

async function clearEpisodes() {
  await db.delete(schema.episodes).where(eq(schema.episodes.showId, SHOW));
}
async function cleanup() {
  await db.delete(schema.episodes).where(inArray(schema.episodes.showId, [SHOW]));
  await db.delete(schema.shows).where(inArray(schema.shows.id, [SHOW]));
}

beforeAll(async () => {
  await cleanup();
  (authModule.auth.api.getSession as unknown) = mockGetSession;
  await db.insert(schema.shows).values({ id: SHOW, title: "Create Test", slug: "test-show-create" });
});
afterAll(async () => { await cleanup(); });
beforeEach(async () => {
  mockGetSession.mockReset();
  addMock.mockReset();
  addMock.mockImplementation(async () => ({}));
  await clearEpisodes(); // isolate each test's episodes (unique (show_id, number) now enforced)
});
afterEach(() => { mockGetSession.mockReset(); });

describe("POST /episodes (single create)", () => {
  test("401 without a session (intent: creating episodes is gated)", async () => {
    anon();
    const res = await postJson("/episodes", { showId: SHOW, number: 1, sourceUrl: SRC });
    expect(res.status).toBe(401);
    expect(addMock).toHaveBeenCalledTimes(0);
  });

  test("201 creates an episode and enqueues exactly one preprocess job (intent: create == enqueue)", async () => {
    authed();
    const res = await postJson("/episodes", { showId: SHOW, number: 1, sourceUrl: SRC });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string; showId: string; number: number };
    expect(body.id).toBeTruthy();
    expect(body.status).toBe("uploaded");
    expect(body.number).toBe(1);
    expect(addMock).toHaveBeenCalledTimes(1);
    const [name, job, opts] = addMock.mock.calls[0] as unknown as [string, { episodeId: string; sourceUrl: string }, { jobId: string }];
    expect(name).toBe("preprocess");
    expect(job.episodeId).toBe(body.id);
    expect(job.sourceUrl).toBe(SRC);
    expect(opts.jobId).toBe(body.id);
    const [row] = await db.select({ id: schema.episodes.id }).from(schema.episodes).where(eq(schema.episodes.id, body.id)).limit(1);
    expect(row!.id).toBe(body.id);
  });

  test("409 episode_exists for a duplicate (showId, number), no second enqueue (intent: dedup)", async () => {
    authed();
    const first = await postJson("/episodes", { showId: SHOW, number: 5, sourceUrl: SRC });
    expect(first.status).toBe(201);
    const firstId = ((await first.json()) as { id: string }).id;
    authed();
    const dup = await postJson("/episodes", { showId: SHOW, number: 5, sourceUrl: SRC });
    expect(dup.status).toBe(409);
    expect((await dup.json()) as { error: string; id: string }).toEqual({ error: "episode_exists", id: firstId });
    expect(addMock).toHaveBeenCalledTimes(1); // only the first created+enqueued
  });

  test("404 show_not_found when the show does not exist (intent: FK guard, no orphan job)", async () => {
    authed();
    const res = await postJson("/episodes", { showId: NOSHOW, number: 1, sourceUrl: SRC });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("show_not_found");
    expect(addMock).toHaveBeenCalledTimes(0);
  });
});

describe("POST /episodes/bulk", () => {
  test("401 without a session (intent: bulk create is gated)", async () => {
    anon();
    const res = await postJson("/episodes/bulk", { showId: SHOW, episodes: [{ number: 1, sourceUrl: SRC }] });
    expect(res.status).toBe(401);
    expect(addMock).toHaveBeenCalledTimes(0);
  });

  test("creates every episode and enqueues one job each (intent: one call ingests a batch)", async () => {
    authed();
    const res = await postJson("/episodes/bulk", { showId: SHOW, episodes: [{ number: 1, sourceUrl: SRC }, { number: 2, sourceUrl: SRC }] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: { number: number; id: string }[]; skipped: unknown[]; failed: unknown[] };
    expect(body.created.length).toBe(2);
    expect(body.skipped.length).toBe(0);
    expect(body.failed.length).toBe(0);
    expect(addMock).toHaveBeenCalledTimes(2);
    const rows = await db.select({ id: schema.episodes.id }).from(schema.episodes).where(eq(schema.episodes.showId, SHOW));
    expect(rows.length).toBe(2);
  });

  test("skips an already-existing (showId, number) and does not enqueue it (intent: idempotent re-import)", async () => {
    const [pre] = await db.insert(schema.episodes).values({ showId: SHOW, number: 10 }).returning({ id: schema.episodes.id });
    authed();
    const res = await postJson("/episodes/bulk", { showId: SHOW, episodes: [{ number: 10, sourceUrl: SRC }, { number: 11, sourceUrl: SRC }] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: { number: number }[]; skipped: { number: number; existingId: string }[]; failed: unknown[] };
    expect(body.created.map((c) => c.number)).toEqual([11]);
    expect(body.skipped).toEqual([{ number: 10, existingId: pre!.id }]);
    expect(addMock).toHaveBeenCalledTimes(1); // only the new one
  });

  test("dedups a duplicate number within the same batch (intent: a batch can't create two of its own)", async () => {
    authed();
    const res = await postJson("/episodes/bulk", { showId: SHOW, episodes: [{ number: 20, sourceUrl: SRC }, { number: 20, sourceUrl: SRC }] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: unknown[]; skipped: unknown[] };
    expect(body.created.length).toBe(1);
    expect(body.skipped.length).toBe(1);
    expect(addMock).toHaveBeenCalledTimes(1);
    const rows = await db.select({ id: schema.episodes.id }).from(schema.episodes).where(and(eq(schema.episodes.showId, SHOW), eq(schema.episodes.number, 20)));
    expect(rows.length).toBe(1);
  });

  test("404 show_not_found, nothing enqueued (intent: validate the show once, up front)", async () => {
    authed();
    const res = await postJson("/episodes/bulk", { showId: NOSHOW, episodes: [{ number: 1, sourceUrl: SRC }] });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("show_not_found");
    expect(addMock).toHaveBeenCalledTimes(0);
  });

  test("400 on an empty episodes array (intent: a bulk call must carry work)", async () => {
    authed();
    const res = await postJson("/episodes/bulk", { showId: SHOW, episodes: [] });
    expect(res.status).toBe(400);
  });

  test("400 when the batch exceeds the cap (intent: bound synchronous work)", async () => {
    authed();
    const episodes = Array.from({ length: 201 }, (_, i) => ({ number: i, sourceUrl: SRC }));
    const res = await postJson("/episodes/bulk", { showId: SHOW, episodes });
    expect(res.status).toBe(400);
  });

  test("on enqueue failure, marks the item failed AND removes the orphan row (intent: a row always has a job)", async () => {
    addMock.mockRejectedValueOnce(new Error("redis down"));
    authed();
    const res = await postJson("/episodes/bulk", { showId: SHOW, episodes: [{ number: 30, sourceUrl: SRC }] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: unknown[]; failed: { number: number; error: string }[] };
    expect(body.created.length).toBe(0);
    expect(body.failed).toEqual([{ number: 30, error: "enqueue_failed" }]);
    const rows = await db.select({ id: schema.episodes.id }).from(schema.episodes).where(and(eq(schema.episodes.showId, SHOW), eq(schema.episodes.number, 30)));
    expect(rows.length).toBe(0); // compensating delete ran
  });
});
