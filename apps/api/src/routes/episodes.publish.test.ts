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
const FAKE_USER = { id: "77777777-0000-0000-0000-000000000001", handle: "rev-sfm29", email: "rev-sfm29@example.com" };
const FAKE_SESSION = { id: "77777777-0000-0000-0000-000000000002", userId: FAKE_USER.id, token: "tok-sfm29", expiresAt: new Date(Date.now() + 24 * 3600 * 1000) };

const mockGetSession = mock();
const authed = () => mockGetSession.mockResolvedValueOnce({ user: FAKE_USER, session: FAKE_SESSION });
const anon = () => mockGetSession.mockResolvedValueOnce(null);
const putObjectMock = mock(async () => {});

mock.module("../lib/r2", () => ({
  putObject: putObjectMock,
  // Re-export other named exports as pass-throughs so any other import isn't broken
  R2_BUCKETS: {},
  presignPut: mock(async () => ""),
  presignGet: mock(async () => ""),
  deleteObject: mock(async () => {}),
}));

// Dynamic import AFTER mock.module so the mocked version is loaded
const { app } = await import("../index");

function seed(needsReview: boolean): CueSeed[] {
  return [{ id: crypto.randomUUID(), orderIndex: 0, startMs: 0, endMs: 1000, text: "hello", rawOverrideTags: "", styleName: "Default", speakerId: null, confidence: 0.5, needsReview }];
}
async function snapshotFor(episodeId: string, seeds: CueSeed[]) {
  const doc = new Y.Doc();
  hydrateCuesIntoDoc(doc, seeds);
  const yjsState = Y.encodeStateAsUpdate(doc);
  await db.insert(schema.snapshots).values({ episodeId, label: "live", yjsState }).onConflictDoNothing();
}
async function cleanup() {
  for (const id of [EP_CLEAN, EP_FLAGGED]) {
    await db.delete(schema.snapshots).where(eq(schema.snapshots.episodeId, id));
    await db.delete(schema.cues).where(eq(schema.cues.episodeId, id));
    await db.delete(schema.episodes).where(eq(schema.episodes.id, id));
  }
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW_ID));
}

beforeAll(async () => {
  await cleanup();
  (authModule.auth.api.getSession as unknown) = mockGetSession;
  await db.insert(schema.shows).values({ id: SHOW_ID, title: "SFM-29 Publish", slug: "sfm-29-publish" });
  for (const [id, flagged] of [[EP_CLEAN, false], [EP_FLAGGED, true]] as const) {
    await db.insert(schema.episodes).values({ id, showId: SHOW_ID, number: id === EP_CLEAN ? 1 : 2, title: "pub fixture", status: "ready_for_edit" });
    await snapshotFor(id, seed(flagged));
  }
});
afterAll(async () => { await cleanup(); });
beforeEach(() => {
  mockGetSession.mockReset();
  putObjectMock.mockReset();
  putObjectMock.mockImplementation(async () => {});
});
afterEach(() => mockGetSession.mockReset());

describe("POST /episodes/:id/publish", () => {
  test("401 without a session (intent: publishing is gated)", async () => {
    anon();
    expect((await app.request(`/episodes/${EP_CLEAN}/publish`, { method: "POST" })).status).toBe(401);
  });
  test("409 when a cue still needs review (intent: never auto-publish unreviewed cues)", async () => {
    authed();
    const res = await app.request(`/episodes/${EP_FLAGGED}/publish`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("unreviewed_cues");
    expect(putObjectMock).toHaveBeenCalledTimes(0);
  });
  test("200 publishes a clean episode: .ass uploaded + status published (intent: the Phase 2 exit gate)", async () => {
    authed();
    const res = await app.request(`/episodes/${EP_CLEAN}/publish`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; key: string };
    expect(body.status).toBe("published");
    expect(body.key).toBe(`subtitles/${EP_CLEAN}/published.ass`);
    expect(putObjectMock).toHaveBeenCalledTimes(1);
    const ass = (putObjectMock.mock.calls[0] as unknown[])[2] as string;
    expect(ass).toContain("[Events]");
    expect(ass).toContain("Dialogue: ");
    expect((putObjectMock.mock.calls[0] as unknown[])[3]).toBe("text/plain; charset=utf-8");
    const [ep] = await db.select({ status: schema.episodes.status }).from(schema.episodes).where(eq(schema.episodes.id, EP_CLEAN)).limit(1);
    expect(ep!.status).toBe("published");
  });
  test("404 for an unknown episode", async () => {
    authed();
    expect((await app.request(`/episodes/00000000-0000-0000-0000-0000000000ff/publish`, { method: "POST" })).status).toBe(404);
  });
  test("re-publishing an already-published episode is an idempotent no-op 200 (intent: retry-safe, no canonical-artifact overwrite)", async () => {
    await db.update(schema.episodes).set({ status: "published" }).where(eq(schema.episodes.id, EP_CLEAN));
    authed();
    const res = await app.request(`/episodes/${EP_CLEAN}/publish`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("published");
    expect(putObjectMock).toHaveBeenCalledTimes(0); // early-return skips re-upload
  });
});
