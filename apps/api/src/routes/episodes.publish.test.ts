import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as Y from "yjs";
import { db } from "../lib/db";
import { schema } from "@subtitle-fm/db";
import { eq } from "drizzle-orm";
import { hydrateCuesIntoDoc, type CueSeed } from "@subtitle-fm/shared/yjs";
import * as authModule from "../lib/auth";

const SHOW_ID = "test-show-sfm29-publish";
const EP_CLEAN = "77777777-7777-7777-7777-777777777771";
const EP_FLAGGED = "77777777-7777-7777-7777-777777777772";
const EP_BADTEXT = "77777777-7777-7777-7777-777777777773";
const FAKE_USER = {
  id: "77777777-0000-0000-0000-000000000001",
  handle: "rev-sfm29",
  email: "rev-sfm29@example.com",
};
const FAKE_SESSION = {
  id: "77777777-0000-0000-0000-000000000002",
  userId: FAKE_USER.id,
  token: "tok-sfm29",
  expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
};

const mockGetSession = mock();
const authed = () => mockGetSession.mockResolvedValueOnce({ user: FAKE_USER, session: FAKE_SESSION });
const anon = () => mockGetSession.mockResolvedValueOnce(null);
const publishAddMock = mock(async () => ({}));

mock.module("../lib/queue", () => ({
  preprocessQueue: { add: mock(async () => ({})) },
  transcribeQueue: { add: mock(async () => ({})) },
  translateQueue: { add: mock(async () => ({})) },
  publishQueue: { add: publishAddMock },
  cleanupMediaQueue: { add: mock(async () => ({})) },
}));

// Dynamic import AFTER mock.module so the mocked version is loaded
const { app } = await import("../index");

function seed(needsReview: boolean): CueSeed[] {
  return [
    {
      id: crypto.randomUUID(),
      orderIndex: 0,
      startMs: 0,
      endMs: 1000,
      text: "hello",
      styleName: "Default",
      speakerId: null,
      confidence: 0.5,
      needsReview,
    },
  ];
}
async function snapshotFor(episodeId: string, seeds: CueSeed[]) {
  const doc = new Y.Doc();
  hydrateCuesIntoDoc(doc, seeds);
  const yjsState = Y.encodeStateAsUpdate(doc);
  await db.insert(schema.snapshots).values({ episodeId, label: "live", yjsState }).onConflictDoNothing();
}
async function cleanup() {
  for (const id of [EP_CLEAN, EP_FLAGGED, EP_BADTEXT]) {
    await db.delete(schema.snapshots).where(eq(schema.snapshots.episodeId, id));
    await db.delete(schema.cues).where(eq(schema.cues.episodeId, id));
    await db.delete(schema.episodes).where(eq(schema.episodes.id, id));
  }
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW_ID));
  await db.delete(schema.users).where(eq(schema.users.id, FAKE_USER.id));
}

beforeAll(async () => {
  await cleanup();
  (authModule.auth.api.getSession as unknown) = mockGetSession;
  await db.insert(schema.users).values({ ...FAKE_USER, role: "admin" });
  await db.insert(schema.shows).values({ id: SHOW_ID, title: "SFM-29 Publish", slug: "sfm-29-publish" });
  for (const [id, flagged] of [
    [EP_CLEAN, false],
    [EP_FLAGGED, true],
  ] as const) {
    await db.insert(schema.episodes).values({
      id,
      showId: SHOW_ID,
      number: id === EP_CLEAN ? 1 : 2,
      title: "pub fixture",
      status: "ready_for_edit",
    });
    await snapshotFor(id, seed(flagged));
  }
  // A cue whose text contains a literal newline — the async worker exhausts retries and fails it.
  await db.insert(schema.episodes).values({
    id: EP_BADTEXT,
    showId: SHOW_ID,
    number: 3,
    title: "bad text fixture",
    status: "ready_for_edit",
  });
  await snapshotFor(EP_BADTEXT, [
    {
      id: crypto.randomUUID(),
      orderIndex: 0,
      startMs: 0,
      endMs: 1000,
      text: "a\nb",
      styleName: "Default",
      speakerId: null,
      confidence: null,
      needsReview: false,
    },
  ]);
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  mockGetSession.mockReset();
  publishAddMock.mockReset();
  publishAddMock.mockImplementation(async () => ({}));
  await db.delete(schema.showRoleAssignments).where(eq(schema.showRoleAssignments.showId, SHOW_ID));
  await db
    .update(schema.users)
    .set({ role: "admin", reputation: 0 })
    .where(eq(schema.users.id, FAKE_USER.id));
});
afterEach(() => mockGetSession.mockReset());

describe("POST /episodes/:id/publish", () => {
  test("401 without a session (intent: publishing is gated)", async () => {
    anon();
    expect((await app.request(`/episodes/${EP_CLEAN}/publish`, { method: "POST" })).status).toBe(401);
  });
  test("403 below the publish reputation threshold even with a publishing role", async () => {
    await db
      .update(schema.users)
      .set({ role: "editor", reputation: 29 })
      .where(eq(schema.users.id, FAKE_USER.id));
    await db.insert(schema.showRoleAssignments).values({
      userId: FAKE_USER.id,
      showId: SHOW_ID,
      role: "qc",
    });
    authed();
    const res = await app.request(`/episodes/${EP_CLEAN}/publish`, { method: "POST" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: "publish_forbidden",
      access: { reputation: 29, showRole: "qc", canPublish: false },
    });
  });
  test("409 when a cue still needs review (intent: never auto-publish unreviewed cues)", async () => {
    authed();
    const res = await app.request(`/episodes/${EP_FLAGGED}/publish`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("unreviewed_cues");
    expect(publishAddMock).toHaveBeenCalledTimes(0);
  });
  test("503 compensates a Redis enqueue failure (intent: retries are not wedged in publishing and no false milestone remains)", async () => {
    publishAddMock.mockImplementationOnce(async () => {
      throw new Error("redis unavailable");
    });
    authed();
    const res = await app.request(`/episodes/${EP_CLEAN}/publish`, { method: "POST" });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("publish_enqueue_failed");

    const [episode] = await db.select({ status: schema.episodes.status }).from(schema.episodes).where(eq(schema.episodes.id, EP_CLEAN)).limit(1);
    expect(episode!.status).toBe("ready_for_edit");
    const snapshots = await db.select({ label: schema.snapshots.label }).from(schema.snapshots).where(eq(schema.snapshots.episodeId, EP_CLEAN));
    expect(snapshots.map((snapshot) => snapshot.label)).toEqual(["live"]);
  });
  test("202 freezes a clean episode and enqueues the publish worker (intent: request latency never includes serialization or R2 uploads)", async () => {
    authed();
    const res = await app.request(`/episodes/${EP_CLEAN}/publish`, { method: "POST" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      status: string;
      key: string;
      keys: { ass: string; srt: string; vtt: string };
      snapshot: { id: string; label: string };
    };
    expect(body.status).toBe("publishing");
    const base = `subtitles/${EP_CLEAN}/published`;
    expect(body.key).toBe(`${base}.ass`);
    expect(body.keys).toEqual({ ass: `${base}.ass`, srt: `${base}.srt`, vtt: `${base}.vtt` });
    expect(body.snapshot.label).toBe("published-v1");
    expect(publishAddMock).toHaveBeenCalledTimes(1);
    const [, payload, options] = publishAddMock.mock.calls[0] as unknown as [
      string,
      { episodeId: string; pipelineRunId: string; snapshotId: string; formats: string[] },
      { jobId: string },
    ];
    expect(payload.episodeId).toBe(EP_CLEAN);
    expect(payload.snapshotId).toBe(body.snapshot.id);
    expect(payload.formats).toEqual(["ass", "srt", "vtt"]);
    expect(options.jobId).toBe(`publish-${body.snapshot.id}`);

    const [frozen] = await db
      .select({ label: schema.snapshots.label, yjsState: schema.snapshots.yjsState })
      .from(schema.snapshots)
      .where(eq(schema.snapshots.id, body.snapshot.id))
      .limit(1);
    expect(frozen!.label).toBe(body.snapshot.label);
    expect(new Uint8Array(frozen!.yjsState).byteLength).toBeGreaterThan(0);
    const [ep] = await db.select({ status: schema.episodes.status }).from(schema.episodes).where(eq(schema.episodes.id, EP_CLEAN)).limit(1);
    expect(ep!.status).toBe("publishing");

    authed();
    const retry = await app.request(`/episodes/${EP_CLEAN}/publish`, { method: "POST" });
    expect(retry.status).toBe(202);
    expect(((await retry.json()) as { status: string }).status).toBe("publishing");
    expect(publishAddMock).toHaveBeenCalledTimes(1);
  });
  test("404 for an unknown episode", async () => {
    authed();
    expect(
      (
        await app.request(`/episodes/00000000-0000-0000-0000-0000000000ff/publish`, {
          method: "POST",
        })
      ).status,
    ).toBe(404);
  });
  test("202 defers serialization to the worker (intent: malformed ASS text fails in the retried async job, not request latency)", async () => {
    authed();
    const res = await app.request(`/episodes/${EP_BADTEXT}/publish`, { method: "POST" });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { status: string }).status).toBe("publishing");
    expect(publishAddMock).toHaveBeenCalledTimes(1);
  });
  test("re-publishing an already-published episode is an idempotent no-op 200 (intent: retry-safe, no canonical-artifact overwrite)", async () => {
    await db.update(schema.episodes).set({ status: "published" }).where(eq(schema.episodes.id, EP_CLEAN));
    authed();
    const res = await app.request(`/episodes/${EP_CLEAN}/publish`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      key: string;
      keys: { ass: string; srt: string; vtt: string };
    };
    expect(body.status).toBe("published");
    const base = `subtitles/${EP_CLEAN}/published`;
    expect(body.keys).toEqual({ ass: `${base}.ass`, srt: `${base}.srt`, vtt: `${base}.vtt` });
    expect(publishAddMock).toHaveBeenCalledTimes(0); // early-return skips re-enqueue
  });
});
