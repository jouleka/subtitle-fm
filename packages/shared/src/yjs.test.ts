import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import {
  applyCueTextEdit,
  computeTextDiff,
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

describe("computeTextDiff", () => {
  test("identical strings yield a no-op diff (intent: a re-render echo must not produce a write)", () => {
    expect(computeTextDiff("hi", "hi")).toEqual({ index: 0, deleteCount: 0, insert: "" });
  });

  test("append at the end (intent: typing at the caret is the common case)", () => {
    expect(computeTextDiff("hi", "hi!")).toEqual({ index: 2, deleteCount: 0, insert: "!" });
  });

  test("prepend at the start (intent: inserting before existing text)", () => {
    expect(computeTextDiff("hi", "oh hi")).toEqual({ index: 0, deleteCount: 0, insert: "oh " });
  });

  test("mid-string insert (intent: fixing a typo by adding a char)", () => {
    expect(computeTextDiff("helo", "hello")).toEqual({ index: 3, deleteCount: 0, insert: "l" });
  });

  test("mid-string delete (intent: removing a stray char)", () => {
    expect(computeTextDiff("hello", "helo")).toEqual({ index: 3, deleteCount: 1, insert: "" });
  });

  test("replace a span (intent: selecting a run and retyping)", () => {
    expect(computeTextDiff("hello", "help")).toEqual({ index: 3, deleteCount: 2, insert: "p" });
  });

  test("full clear (intent: select-all then delete)", () => {
    expect(computeTextDiff("abc", "")).toEqual({ index: 0, deleteCount: 3, insert: "" });
  });
});

describe("applyCueTextEdit", () => {
  const seed = (id: string, text: string): CueSeed => ({
    id,
    orderIndex: 0,
    startMs: 0,
    endMs: 1000,
    text,
    rawOverrideTags: "",
    styleName: "Default",
    speakerId: null,
    confidence: null,
    needsReview: false,
  });

  test("applies a minimal edit to the cue's Y.Text and reflects in liveCuesFromDoc (intent: keystroke autosave is observable)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [seed("a", "helo")]);
    const changed = applyCueTextEdit(doc, "a", "hello");
    expect(changed).toBe(true);
    expect(liveCuesFromDoc(doc)[0]!.text).toBe("hello");
  });

  test("a no-op edit writes nothing and returns false (intent: own re-render echoes must not churn the doc)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [seed("a", "hello")]);
    let txnFired = false;
    doc.on("afterTransaction", (tx: Y.Transaction) => {
      if (tx.changed.size > 0) txnFired = true;
    });
    const changed = applyCueTextEdit(doc, "a", "hello");
    expect(changed).toBe(false);
    expect(txnFired).toBe(false);
  });

  test("an unknown cue id returns false and leaves the doc unchanged (intent: stale ids must never corrupt state)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [seed("a", "hello")]);
    const before = liveCuesFromDoc(doc);
    const changed = applyCueTextEdit(doc, "missing", "x");
    expect(changed).toBe(false);
    expect(liveCuesFromDoc(doc)).toEqual(before);
  });

  test("the write transaction is tagged origin 'sfm-24-text' (intent: observers can filter their own echoes)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [seed("a", "")]);
    let origin: unknown = null;
    doc.on("afterTransaction", (tx: Y.Transaction) => {
      if (tx.changed.size > 0 && origin === null) origin = tx.origin;
    });
    applyCueTextEdit(doc, "a", "hi");
    expect(origin).toBe("sfm-24-text");
  });

  test("mutates the existing Y.Text in place rather than replacing it (intent: preserve the collaborative text object's identity)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [seed("a", "hi")]);
    const yArr = doc.getArray<Y.Map<unknown>>(CUES_ARRAY_KEY);
    const before = yArr.get(0)!.get("text");
    applyCueTextEdit(doc, "a", "hi there");
    const after = yArr.get(0)!.get("text");
    expect(after).toBe(before);
  });
});
