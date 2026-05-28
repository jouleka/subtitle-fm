import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import {
  CUES_ARRAY_KEY,
  cueMapToLive,
  hydrateCuesIntoDoc,
  liveCuesFromDoc,
  retimeCue,
  type CueSeed,
} from "./yjs";

const sampleSeed: CueSeed = {
  id: "11111111-1111-1111-1111-111111111111",
  orderIndex: 0,
  startMs: 0,
  endMs: 1000,
  text: "hello",
  rawOverrideTags: "",
  styleName: "Default",
  speakerId: null,
  confidence: 0.9,
  needsReview: false,
};

describe("hydrateCuesIntoDoc", () => {
  test("empty doc with no seeds yields no live cues (intent: empty episode is a real state)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, []);
    expect(liveCuesFromDoc(doc)).toEqual([]);
  });

  test("hydrates one seed and round-trips through liveCuesFromDoc (intent: server seeds match client view)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [sampleSeed]);
    const live = liveCuesFromDoc(doc);
    expect(live).toEqual([sampleSeed]);
  });

  test("is idempotent on a populated doc (intent: re-running hydration must not duplicate)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [sampleSeed]);
    hydrateCuesIntoDoc(doc, [sampleSeed]);
    expect(liveCuesFromDoc(doc)).toHaveLength(1);
  });

  test("hydrated text is a Y.Text and edits propagate to cueMapToLive (intent: text is collaborative, plain fields are not)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [sampleSeed]);
    const yArr = doc.getArray<Y.Map<unknown>>(CUES_ARRAY_KEY);
    const cueMap = yArr.get(0);
    const text = cueMap.get("text") as Y.Text;
    text.insert(5, " world");
    expect(cueMapToLive(cueMap).text).toBe("hello world");
  });
});

describe("retimeCue", () => {
  const seedAt = (id: string, orderIndex: number, startMs: number, endMs: number): CueSeed => ({
    id,
    orderIndex,
    startMs,
    endMs,
    text: "",
    rawOverrideTags: "",
    styleName: "Default",
    speakerId: null,
    confidence: null,
    needsReview: false,
  });
  test("returns not-found and leaves the doc unchanged for unknown cue id (intent: stale references must never corrupt state)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [seedAt("a", 0, 0, 1000)]);
    const before = liveCuesFromDoc(doc);
    const result = retimeCue(doc, "does-not-exist", 500, 1500);
    expect(result).toEqual({ ok: false, reason: "not-found" });
    expect(liveCuesFromDoc(doc)).toEqual(before);
  });

  test("happy-path retime updates start and end on the middle cue (intent: drag-to-retime is the canonical write path)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [
      seedAt("a", 0, 0, 1000),
      seedAt("b", 1, 2000, 3000),
      seedAt("c", 2, 4000, 5000),
    ]);
    const result = retimeCue(doc, "b", 2200, 2800);
    expect(result).toEqual({ ok: true, startMs: 2200, endMs: 2800 });
    const cues = liveCuesFromDoc(doc);
    expect(cues[1]).toMatchObject({ id: "b", startMs: 2200, endMs: 2800 });
  });

  test("clamps start forward to prev.endMs when the requested start would overlap (intent: no overlapping cues)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [
      seedAt("a", 0, 0, 1000),
      seedAt("b", 1, 2000, 3000),
    ]);
    const result = retimeCue(doc, "b", 500, 2800);
    expect(result).toEqual({ ok: true, startMs: 1000, endMs: 2800 });
    expect(liveCuesFromDoc(doc)[1]!.startMs).toBe(1000);
  });

  test("clamps end back to next.startMs when the requested end would overlap (intent: no overlapping cues)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [
      seedAt("a", 0, 0, 1000),
      seedAt("b", 1, 2000, 3000),
      seedAt("c", 2, 4000, 5000),
    ]);
    const result = retimeCue(doc, "b", 2200, 5000);
    expect(result).toEqual({ ok: true, startMs: 2200, endMs: 4000 });
    expect(liveCuesFromDoc(doc)[1]!.endMs).toBe(4000);
  });

  test("rejects with invalid-range when clamped duration falls below MIN_CUE_DURATION_MS (intent: protect against zero-duration cues)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [
      seedAt("a", 0, 0, 1000),
      seedAt("b", 1, 1050, 2000),
    ]);
    const result = retimeCue(doc, "b", 500, 1050);
    expect(result).toEqual({ ok: false, reason: "invalid-range" });
    expect(liveCuesFromDoc(doc)[1]).toMatchObject({ startMs: 1050, endMs: 2000 });
  });

  test("first cue retime can extend start down to 0 (intent: episode start is a valid edge)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [
      seedAt("a", 0, 500, 1000),
      seedAt("b", 1, 2000, 3000),
    ]);
    const result = retimeCue(doc, "a", 0, 800);
    expect(result).toEqual({ ok: true, startMs: 0, endMs: 800 });
    expect(liveCuesFromDoc(doc)[0]!.startMs).toBe(0);
  });

  test("last cue retime can extend end past any explicit bound (intent: episode end is open)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [
      seedAt("a", 0, 0, 1000),
      seedAt("b", 1, 2000, 3000),
    ]);
    const result = retimeCue(doc, "b", 2200, 999_999);
    expect(result).toEqual({ ok: true, startMs: 2200, endMs: 999_999 });
  });

  test("transaction is tagged with origin 'sfm-23-retime' (intent: observers can filter out their own retime echoes)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [
      seedAt("a", 0, 0, 1000),
      seedAt("b", 1, 2000, 3000),
    ]);
    let observedOrigin: unknown = null;
    doc.on("afterTransaction", (tx: Y.Transaction) => {
      if (tx.changed.size > 0 && observedOrigin === null) observedOrigin = tx.origin;
    });
    retimeCue(doc, "b", 2200, 2800);
    expect(observedOrigin).toBe("sfm-23-retime");
  });
});
