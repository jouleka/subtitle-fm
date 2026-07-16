import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { fetchDocumentState, storeDocumentState } from "./persistence";
import { db } from "./db";
import { schema } from "@subtitle-fm/db";
import { eq, and } from "drizzle-orm";
import {
  CUES_ARRAY_KEY,
  liveCuesFromDoc,
  liveCuesFromSnapshot,
  hydrateCuesIntoDoc,
  type CueSeed,
} from "@subtitle-fm/shared/yjs";

const SHOW_ID = "test-show-sfm25-persist";
const EPISODE_ID = "66666666-6666-6666-6666-666666666661";
const BRANCH_ID = "66666666-6666-4666-8666-666666666662";

async function cleanup() {
  await db.delete(schema.subtitleBranches).where(eq(schema.subtitleBranches.episodeId, EPISODE_ID));
  await db
    .delete(schema.snapshots)
    .where(eq(schema.snapshots.episodeId, EPISODE_ID));
  await db.delete(schema.cues).where(eq(schema.cues.episodeId, EPISODE_ID));
  await db.delete(schema.episodes).where(eq(schema.episodes.id, EPISODE_ID));
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW_ID));
}

const cueSeeds: CueSeed[] = [
  {
    id: "66666666-6666-6666-6666-666666660001",
    orderIndex: 0,
    startMs: 0,
    endMs: 1000,
    text: "first cue",
    styleName: "Default",
    speakerId: null,
    confidence: null,
    needsReview: false,
  },
  {
    id: "66666666-6666-6666-6666-666666660002",
    orderIndex: 1,
    startMs: 1000,
    endMs: 2000,
    text: "second cue",
    styleName: "Default",
    speakerId: null,
    confidence: null,
    needsReview: true,
  },
];

beforeAll(async () => {
  await cleanup();
  await db.insert(schema.shows).values({
    id: SHOW_ID,
    title: "SFM-25 Persist Show",
    slug: "sfm-25-persist",
  });
  await db.insert(schema.episodes).values({
    id: EPISODE_ID,
    showId: SHOW_ID,
    number: 1,
    title: "Persist fixture",
    status: "ready_for_edit",
  });
  await db.insert(schema.cues).values(
    cueSeeds.map((s) => ({
      id: s.id,
      episodeId: EPISODE_ID,
      orderIndex: s.orderIndex,
      startMs: s.startMs,
      endMs: s.endMs,
      text: s.text,
      styleName: s.styleName,
      speakerId: s.speakerId,
      confidence: s.confidence,
      needsReview: s.needsReview,
    })),
  );
});

afterAll(async () => {
  await cleanup();
});

describe("fetchDocumentState", () => {
  test("returns hydrated Yjs state from cues when no snapshot exists (intent: first connect seeds from cues)", async () => {
    const state = await fetchDocumentState(EPISODE_ID);
    expect(state).not.toBeNull();
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state!);
    const live = liveCuesFromDoc(doc);
    expect(live.map((c) => c.text)).toEqual(["first cue", "second cue"]);
    expect(live[1]!.needsReview).toBe(true);
  });

  test("returns snapshot bytes when one exists, ignoring cues table (intent: snapshot is source of truth post-init)", async () => {
    // Write a snapshot whose cue list differs from the seed cues
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [
      { ...cueSeeds[0]!, text: "MUTATED via snapshot" },
    ]);
    const snapshotState = Y.encodeStateAsUpdate(doc);
    await storeDocumentState(EPISODE_ID, snapshotState);

    const state = await fetchDocumentState(EPISODE_ID);
    expect(state).not.toBeNull();
    const restored = new Y.Doc();
    Y.applyUpdate(restored, state!);
    const live = liveCuesFromDoc(restored);
    expect(live).toHaveLength(1);
    expect(live[0]!.text).toBe("MUTATED via snapshot");
  });
});

describe("storeDocumentState", () => {
  test("upserts a single (episode, 'live') row, not multiple (intent: rolling live state)", async () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, cueSeeds);
    const a = Y.encodeStateAsUpdate(doc);
    await storeDocumentState(EPISODE_ID, a);

    const text = doc.getArray<Y.Map<unknown>>(CUES_ARRAY_KEY).get(0).get("text") as Y.Text;
    text.insert(text.length, " (edited)");
    const b = Y.encodeStateAsUpdate(doc);
    await storeDocumentState(EPISODE_ID, b);

    const rows = await db
      .select()
      .from(schema.snapshots)
      .where(
        and(
          eq(schema.snapshots.episodeId, EPISODE_ID),
          eq(schema.snapshots.label, "live"),
        ),
      );
    expect(rows).toHaveLength(1);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, rows[0]!.yjsState);
    const live = liveCuesFromDoc(restored);
    expect(live[0]!.text).toBe("first cue (edited)");
  });

  test("loads and persists an isolated branch document", async () => {
    const [base] = await db
      .insert(schema.snapshots)
      .values({ episodeId: EPISODE_ID, label: "branch-base", yjsState: new Uint8Array([0]) })
      .returning({ id: schema.snapshots.id });
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [{ ...cueSeeds[0]!, text: "branch fork" }]);
    await db.insert(schema.subtitleBranches).values({
      id: BRANCH_ID,
      episodeId: EPISODE_ID,
      name: "alternate",
      baseSnapshotId: base!.id,
      yjsState: Y.encodeStateAsUpdate(doc),
    });

    const documentName = `branch:${BRANCH_ID}`;
    const initial = await fetchDocumentState(documentName);
    expect(liveCuesFromSnapshot(initial!)[0]!.text).toBe("branch fork");

    const text = doc.getArray<Y.Map<unknown>>(CUES_ARRAY_KEY).get(0).get("text") as Y.Text;
    text.insert(text.length, " edited");
    await storeDocumentState(documentName, Y.encodeStateAsUpdate(doc));
    const [stored] = await db
      .select({ yjsState: schema.subtitleBranches.yjsState })
      .from(schema.subtitleBranches)
      .where(eq(schema.subtitleBranches.id, BRANCH_ID));
    expect(liveCuesFromSnapshot(stored!.yjsState)[0]!.text).toBe("branch fork edited");
  });
});
