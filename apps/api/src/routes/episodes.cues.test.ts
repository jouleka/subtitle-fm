import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { app } from "../index";
import { db } from "../lib/db";
import { schema } from "@subtitle-fm/db";
import { eq } from "drizzle-orm";

const TEST_SHOW_ID = "test-show-sfm21-cues";
const TEST_EPISODE_ID = "44444444-4444-4444-4444-444444444444";
const NONEXISTENT_ID = "99999999-9999-9999-9999-999999999999";

async function cleanup() {
  await db.delete(schema.cues).where(eq(schema.cues.episodeId, TEST_EPISODE_ID));
  await db.delete(schema.episodes).where(eq(schema.episodes.id, TEST_EPISODE_ID));
  await db.delete(schema.shows).where(eq(schema.shows.id, TEST_SHOW_ID));
}

beforeAll(async () => {
  await cleanup(); // in case of stale state
  await db.insert(schema.shows).values({
    id: TEST_SHOW_ID,
    title: "Test Show SFM-21",
    slug: "test-show-sfm-21-cues",
  }).onConflictDoNothing();
  await db.insert(schema.episodes).values({
    id: TEST_EPISODE_ID,
    showId: TEST_SHOW_ID,
    number: 1,
    title: "Cues fixture episode",
    status: "ready_for_edit",
  }).onConflictDoNothing();
  // Seed cues with shuffled orderIndex to verify ordering
  await db.insert(schema.cues).values([
    { episodeId: TEST_EPISODE_ID, orderIndex: 2, startMs: 2000, endMs: 3000, text: "two" },
    { episodeId: TEST_EPISODE_ID, orderIndex: 0, startMs: 0, endMs: 1000, text: "zero" },
    { episodeId: TEST_EPISODE_ID, orderIndex: 1, startMs: 1000, endMs: 2000, text: "one" },
  ]);
});

afterAll(async () => {
  await cleanup();
});

describe("GET /episodes/:id/cues", () => {
  test("returns cues ordered by orderIndex ascending (intent: editor renders cues in playback order)", async () => {
    const res = await app.request(`/episodes/${TEST_EPISODE_ID}/cues`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cues: Array<{ orderIndex: number; text: string }> };
    expect(body.cues.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
    expect(body.cues.map((c) => c.text)).toEqual(["zero", "one", "two"]);
  });

  test("returns 404 when episode does not exist (intent: do not leak existence by returning empty list)", async () => {
    const res = await app.request(`/episodes/${NONEXISTENT_ID}/cues`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("episode_not_found");
  });
});
