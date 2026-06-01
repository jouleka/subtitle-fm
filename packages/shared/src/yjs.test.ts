import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import {
  applyCueTextEdit,
  computeTextDiff,
  CUES_ARRAY_KEY,
  cueMapToLive,
  DEFAULT_NEW_CUE_MS,
  deleteCue,
  hydrateCuesIntoDoc,
  insertCue,
  liveCuesFromDoc,
  liveCuesFromSnapshot,
  moveCue,
  retimeCue,
  splitCue,
  toggleCueNeedsReview,
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

  test("prepend at the start (intent: a prepend is a real write at index 0, not a no-op)", () => {
    expect(computeTextDiff("hi", "oh hi")).toEqual({ index: 0, deleteCount: 0, insert: "oh " });
  });

  test("mid-string insert (intent: a one-char insert must not rewrite the whole string)", () => {
    expect(computeTextDiff("helo", "hello")).toEqual({ index: 3, deleteCount: 0, insert: "l" });
  });

  test("mid-string delete (intent: a one-char delete must not expand into a full replace)", () => {
    expect(computeTextDiff("hello", "helo")).toEqual({ index: 3, deleteCount: 1, insert: "" });
  });

  test("replace a span (intent: a replaced run is one contiguous op, not delete-all + insert-all)", () => {
    expect(computeTextDiff("hello", "help")).toEqual({ index: 3, deleteCount: 2, insert: "p" });
  });

  test("full clear (intent: clearing emits a single delete from index 0 with no insert)", () => {
    expect(computeTextDiff("abc", "")).toEqual({ index: 0, deleteCount: 3, insert: "" });
  });

  test("inserting a repeated char does not double-count the overlap (intent: the prefix/suffix scans must not both claim the same matching run)", () => {
    expect(computeTextDiff("aa", "aaa")).toEqual({ index: 2, deleteCount: 0, insert: "a" });
  });

  test("swapping an emoji keeps whole surrogate pairs in the diff (intent: splitting a pair writes a lone surrogate that corrupts the Y.Text)", () => {
    expect(computeTextDiff("a\u{1F600}b", "a\u{1F601}b")).toEqual({
      index: 1,
      deleteCount: 2,
      insert: "\u{1F601}",
    });
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

  test("an emoji swap round-trips without surrogate corruption (intent: the editor must not mangle reaction-emoji edits in subtitles)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, [seed("a", "a\u{1F600}b")]);
    applyCueTextEdit(doc, "a", "a\u{1F601}b");
    expect(liveCuesFromDoc(doc)[0]!.text).toBe("a\u{1F601}b");
  });
});

const seedFixture = (): CueSeed[] => [
  { id: "11111111-0000-0000-0000-000000000001", orderIndex: 0, startMs: 0, endMs: 1000, text: "one", rawOverrideTags: "", styleName: "Default", speakerId: null, confidence: 0.4, needsReview: true },
  { id: "11111111-0000-0000-0000-000000000002", orderIndex: 1, startMs: 1000, endMs: 2000, text: "two", rawOverrideTags: "", styleName: "Default", speakerId: null, confidence: 0.9, needsReview: false },
];

describe("toggleCueNeedsReview", () => {
  test("clears a flag and reports the change (intent: a reviewer accepts a low-confidence cue)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, seedFixture());
    const changed = toggleCueNeedsReview(doc, "11111111-0000-0000-0000-000000000001", false);
    expect(changed).toBe(true);
    expect(liveCuesFromDoc(doc).find((c) => c.id === "11111111-0000-0000-0000-000000000001")!.needsReview).toBe(false);
  });
  test("no-ops when already at the target value (intent: idempotent accept doesn't churn the doc)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, seedFixture());
    expect(toggleCueNeedsReview(doc, "11111111-0000-0000-0000-000000000002", false)).toBe(false);
  });
  test("no-ops for a missing cue id (intent: a stale id from a removed cue is harmless)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, seedFixture());
    expect(toggleCueNeedsReview(doc, "deadbeef-0000-0000-0000-000000000000", false)).toBe(false);
  });
});

describe("liveCuesFromSnapshot", () => {
  test("round-trips cues incl. needsReview (intent: publish decodes the authoritative Y.Doc snapshot)", () => {
    const doc = new Y.Doc();
    hydrateCuesIntoDoc(doc, seedFixture());
    const bytes = Y.encodeStateAsUpdate(doc);
    const cues = liveCuesFromSnapshot(bytes);
    expect(cues.map((c) => c.text)).toEqual(["one", "two"]);
    expect(cues.map((c) => c.needsReview)).toEqual([true, false]);
  });
});

// --- SFM-51 splitCue (reconcile mkDoc/mkSeed with any existing helper) ---
function mkSeed(
  over: Partial<CueSeed> & { id: string; orderIndex: number; startMs: number; endMs: number; text: string },
): CueSeed {
  return { rawOverrideTags: "", styleName: "Default", speakerId: null, confidence: null, needsReview: false, ...over };
}
function mkDoc(seeds: CueSeed[]): Y.Doc {
  const doc = new Y.Doc();
  hydrateCuesIntoDoc(doc, seeds);
  return doc;
}

test("splitCue divides text at the caret and the time range proportionally so the halves abut", () => {
  const doc = mkDoc([mkSeed({ id: "c1", orderIndex: 0, startMs: 0, endMs: 1100, text: "hello world" })]);
  const res = splitCue(doc, "c1", 5);
  expect(res.ok).toBe(true);
  const cues = liveCuesFromDoc(doc);
  expect(cues.map((c) => c.text)).toEqual(["hello", " world"]);
  expect(cues[0]!.startMs).toBe(0);
  expect(cues[0]!.endMs).toBe(500); // round(1100 * 5/11)
  expect(cues[1]!.startMs).toBe(500);
  expect(cues[1]!.endMs).toBe(1100);
  expect(cues[0]!.endMs).toBe(cues[1]!.startMs);
  expect(cues.map((c) => c.orderIndex)).toEqual([0, 1]);
  if (res.ok) expect(cues[1]!.id).toBe(res.newCueId);
});

test("splitCue keeps the cue list sorted by startMs (retimeCue's neighbour invariant holds)", () => {
  const doc = mkDoc([
    mkSeed({ id: "c1", orderIndex: 0, startMs: 0, endMs: 1000, text: "alpha beta" }),
    mkSeed({ id: "c2", orderIndex: 1, startMs: 1000, endMs: 2000, text: "second" }),
  ]);
  splitCue(doc, "c1", 5);
  const starts = liveCuesFromDoc(doc).map((c) => c.startMs);
  expect(starts).toEqual([...starts].sort((a, b) => a - b));
});

test("splitCue's new half inherits needsReview so a flagged cue can't be split past the review gate", () => {
  const doc = mkDoc([mkSeed({ id: "c1", orderIndex: 0, startMs: 0, endMs: 1000, text: "flagged text", needsReview: true })]);
  splitCue(doc, "c1", 7);
  const cues = liveCuesFromDoc(doc);
  expect(cues[0]!.needsReview).toBe(true);
  expect(cues[1]!.needsReview).toBe(true);
});

test("splitCue inherits styleName/speakerId and resets confidence on the new half", () => {
  const doc = mkDoc([
    mkSeed({ id: "c1", orderIndex: 0, startMs: 0, endMs: 1000, text: "hi there", styleName: "Sign", speakerId: "spk1", confidence: 0.4 }),
  ]);
  splitCue(doc, "c1", 2);
  const nu = liveCuesFromDoc(doc)[1]!;
  expect(nu.styleName).toBe("Sign");
  expect(nu.speakerId).toBe("spk1");
  expect(nu.confidence).toBeNull();
});

test("splitCue rejects an empty half (caret at start or end) — no orphan cues without a delete op", () => {
  const doc = mkDoc([mkSeed({ id: "c1", orderIndex: 0, startMs: 0, endMs: 1000, text: "word" })]);
  expect(splitCue(doc, "c1", 0)).toEqual({ ok: false, reason: "empty-half" });
  expect(splitCue(doc, "c1", 4)).toEqual({ ok: false, reason: "empty-half" });
  expect(liveCuesFromDoc(doc).length).toBe(1);
});

test("splitCue rejects when the cue is too short for two >= MIN_CUE_DURATION_MS halves", () => {
  const doc = mkDoc([mkSeed({ id: "c1", orderIndex: 0, startMs: 0, endMs: 150, text: "ab" })]);
  expect(splitCue(doc, "c1", 1)).toEqual({ ok: false, reason: "too-short" });
});

test("splitCue returns not-found for an unknown cue id", () => {
  const doc = mkDoc([mkSeed({ id: "c1", orderIndex: 0, startMs: 0, endMs: 1000, text: "abc" })]);
  expect(splitCue(doc, "nope", 1)).toEqual({ ok: false, reason: "not-found" });
});

test("splitCue snaps a caret inside a surrogate pair so neither half holds a lone surrogate", () => {
  const doc = mkDoc([mkSeed({ id: "c1", orderIndex: 0, startMs: 0, endMs: 1000, text: "a\u{1F600}b" })]);
  const res = splitCue(doc, "c1", 2);
  expect(res.ok).toBe(true);
  const cues = liveCuesFromDoc(doc);
  expect(cues[0]!.text).toBe("a");
  expect(cues[1]!.text).toBe("\u{1F600}b");
});

test("splitCue renumbers orderIndex to array index", () => {
  const doc = mkDoc([
    mkSeed({ id: "c1", orderIndex: 0, startMs: 0, endMs: 1000, text: "one two" }),
    mkSeed({ id: "c2", orderIndex: 1, startMs: 1000, endMs: 2000, text: "b" }),
    mkSeed({ id: "c3", orderIndex: 2, startMs: 2000, endMs: 3000, text: "c" }),
  ]);
  splitCue(doc, "c1", 3);
  expect(liveCuesFromDoc(doc).map((c) => c.orderIndex)).toEqual([0, 1, 2, 3]);
});

test("splitCue's new cue Y.Map has the same field set as a seeded cue (guards field-drift)", () => {
  const doc = mkDoc([mkSeed({ id: "c1", orderIndex: 0, startMs: 0, endMs: 1000, text: "left right" })]);
  splitCue(doc, "c1", 4);
  const yArr = doc.getArray<Y.Map<unknown>>(CUES_ARRAY_KEY);
  expect(new Set(yArr.get(1)!.keys())).toEqual(new Set(yArr.get(0)!.keys()));
});

// --- SFM-51 moveCue ---
test("moveCue down swaps a cue with its successor in array order", () => {
  const doc = mkDoc([
    mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A" }),
    mkSeed({ id: "b", orderIndex: 1, startMs: 1000, endMs: 2000, text: "B" }),
    mkSeed({ id: "c", orderIndex: 2, startMs: 2000, endMs: 3000, text: "C" }),
  ]);
  expect(moveCue(doc, "a", "down")).toEqual({ ok: true });
  expect(liveCuesFromDoc(doc).map((c) => c.id)).toEqual(["b", "a", "c"]);
});

test("moveCue up moves a cue toward the start", () => {
  const doc = mkDoc([
    mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A" }),
    mkSeed({ id: "b", orderIndex: 1, startMs: 1000, endMs: 2000, text: "B" }),
    mkSeed({ id: "c", orderIndex: 2, startMs: 2000, endMs: 3000, text: "C" }),
  ]);
  expect(moveCue(doc, "c", "up")).toEqual({ ok: true });
  expect(liveCuesFromDoc(doc).map((c) => c.id)).toEqual(["a", "c", "b"]);
});

test("moveCue preserves the moved cue's id/text/time/needsReview (position-move keeps its time)", () => {
  const doc = mkDoc([
    mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A", needsReview: true }),
    mkSeed({ id: "b", orderIndex: 1, startMs: 1000, endMs: 2000, text: "B" }),
  ]);
  moveCue(doc, "a", "down");
  const moved = liveCuesFromDoc(doc).find((c) => c.id === "a")!;
  expect(moved.text).toBe("A");
  expect(moved.startMs).toBe(0);
  expect(moved.endMs).toBe(1000);
  expect(moved.needsReview).toBe(true);
});

test("moveCue renumbers orderIndex to array index", () => {
  const doc = mkDoc([
    mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A" }),
    mkSeed({ id: "b", orderIndex: 1, startMs: 1000, endMs: 2000, text: "B" }),
    mkSeed({ id: "c", orderIndex: 2, startMs: 2000, endMs: 3000, text: "C" }),
  ]);
  moveCue(doc, "a", "down");
  expect(liveCuesFromDoc(doc).map((c) => c.orderIndex)).toEqual([0, 1, 2]);
});

test("a position-move desorts the array by startMs (the move reorders the list; time travels)", () => {
  const doc = mkDoc([
    mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A" }),
    mkSeed({ id: "b", orderIndex: 1, startMs: 1000, endMs: 2000, text: "B" }),
  ]);
  moveCue(doc, "a", "down");
  expect(liveCuesFromDoc(doc).map((c) => c.startMs)).toEqual([1000, 0]);
});

test("after a move, sorting cues by orderIndex yields the new array order (so publish reflects the move)", () => {
  const doc = mkDoc([
    mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A" }),
    mkSeed({ id: "b", orderIndex: 1, startMs: 1000, endMs: 2000, text: "B" }),
  ]);
  moveCue(doc, "a", "down");
  const cues = liveCuesFromDoc(doc);
  const byOrderIndex = [...cues].sort((x, y) => x.orderIndex - y.orderIndex).map((c) => c.id);
  expect(byOrderIndex).toEqual(cues.map((c) => c.id));
  expect(byOrderIndex).toEqual(["b", "a"]);
});

test("moveCue rejects at the edges", () => {
  const doc = mkDoc([
    mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A" }),
    mkSeed({ id: "b", orderIndex: 1, startMs: 1000, endMs: 2000, text: "B" }),
  ]);
  expect(moveCue(doc, "a", "up")).toEqual({ ok: false, reason: "edge" });
  expect(moveCue(doc, "b", "down")).toEqual({ ok: false, reason: "edge" });
});

test("moveCue returns not-found for an unknown cue", () => {
  const doc = mkDoc([mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A" })]);
  expect(moveCue(doc, "zzz", "down")).toEqual({ ok: false, reason: "not-found" });
});

test("moveCue's clone Y.Map has the same field set as a seeded cue (guards field-drift)", () => {
  const doc = mkDoc([
    mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A" }),
    mkSeed({ id: "b", orderIndex: 1, startMs: 1000, endMs: 2000, text: "B" }),
  ]);
  moveCue(doc, "a", "down");
  const yArr = doc.getArray<Y.Map<unknown>>(CUES_ARRAY_KEY);
  expect(new Set(yArr.get(1)!.keys())).toEqual(new Set(yArr.get(0)!.keys()));
});

// --- SFM-56 insertCue ---
test("insertCue appends after the last cue into open time, leaving the anchor unchanged", () => {
  const doc = mkDoc([
    mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A", styleName: "Sign", speakerId: "spk1" }),
  ]);
  const res = insertCue(doc, "a");
  expect(res.ok).toBe(true);
  const cues = liveCuesFromDoc(doc);
  expect(cues.length).toBe(2);
  expect(cues[0]!.id).toBe("a");
  expect(cues[0]!.startMs).toBe(0);
  expect(cues[0]!.endMs).toBe(1000); // anchor unchanged
  expect(cues[1]!.startMs).toBe(1000);
  expect(cues[1]!.endMs).toBe(1000 + DEFAULT_NEW_CUE_MS);
  expect(cues[1]!.text).toBe("");
  expect(cues[1]!.needsReview).toBe(true);
  expect(cues[1]!.styleName).toBe("Sign");
  expect(cues[1]!.speakerId).toBe("spk1");
  expect(cues[1]!.confidence).toBeNull();
  expect(cues.map((c) => c.orderIndex)).toEqual([0, 1]);
  if (res.ok) expect(cues[1]!.id).toBe(res.newCueId);
});

test("insertCue fills a gap up to the next cue (clamped to nextStart), not shrinking the anchor", () => {
  const doc = mkDoc([
    mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A" }),
    mkSeed({ id: "b", orderIndex: 1, startMs: 1500, endMs: 2500, text: "B" }), // 500ms gap after a
  ]);
  const res = insertCue(doc, "a");
  expect(res.ok).toBe(true);
  const cues = liveCuesFromDoc(doc);
  expect(cues[0]!.endMs).toBe(1000); // anchor unchanged
  expect(cues[1]!.startMs).toBe(1000);
  expect(cues[1]!.endMs).toBe(1500); // clamped to next.startMs (gap < DEFAULT)
  expect(cues[2]!.id).toBe("b"); // next untouched
});

test("insertCue carves the anchor's back half when it abuts the next cue", () => {
  const doc = mkDoc([
    mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A" }),
    mkSeed({ id: "b", orderIndex: 1, startMs: 1000, endMs: 2000, text: "B" }), // abuts a
  ]);
  const res = insertCue(doc, "a");
  expect(res.ok).toBe(true);
  const cues = liveCuesFromDoc(doc);
  expect(cues[0]!.id).toBe("a");
  expect(cues[0]!.endMs).toBe(500); // carved to midpoint
  expect(cues[1]!.startMs).toBe(500);
  expect(cues[1]!.endMs).toBe(1000);
  expect(cues[2]!.id).toBe("b");
  expect(cues[2]!.startMs).toBe(1000); // next untouched
  expect(cues[2]!.endMs).toBe(2000);
  const starts = cues.map((c) => c.startMs);
  expect(starts).toEqual([...starts].sort((x, y) => x - y)); // still sorted by startMs
});

test("insertCue with null on an empty doc creates the first cue at [0, DEFAULT]", () => {
  const doc = mkDoc([]);
  const res = insertCue(doc, null);
  expect(res.ok).toBe(true);
  const cues = liveCuesFromDoc(doc);
  expect(cues.length).toBe(1);
  expect(cues[0]!.startMs).toBe(0);
  expect(cues[0]!.endMs).toBe(DEFAULT_NEW_CUE_MS);
  expect(cues[0]!.text).toBe("");
  expect(cues[0]!.needsReview).toBe(true);
  expect(cues[0]!.orderIndex).toBe(0);
});

test("insertCue with null on a non-empty doc appends after the last cue", () => {
  const doc = mkDoc([
    mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A" }),
    mkSeed({ id: "b", orderIndex: 1, startMs: 1000, endMs: 2000, text: "B" }),
  ]);
  insertCue(doc, null);
  const cues = liveCuesFromDoc(doc);
  expect(cues.length).toBe(3);
  expect(cues[2]!.startMs).toBe(2000);
  expect(cues[2]!.endMs).toBe(2000 + DEFAULT_NEW_CUE_MS);
});

test("insertCue rejects too-short when the anchor abuts its next neighbour and is under 2x MIN", () => {
  const doc = mkDoc([
    mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 150, text: "A" }), // 150ms < 200
    mkSeed({ id: "b", orderIndex: 1, startMs: 150, endMs: 1150, text: "B" }), // abuts a
  ]);
  expect(insertCue(doc, "a")).toEqual({ ok: false, reason: "too-short" });
  expect(liveCuesFromDoc(doc).length).toBe(2); // no write
});

test("insertCue returns not-found for an unknown afterCueId", () => {
  const doc = mkDoc([mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A" })]);
  expect(insertCue(doc, "nope")).toEqual({ ok: false, reason: "not-found" });
  expect(liveCuesFromDoc(doc).length).toBe(1);
});

test("insertCue's new cue Y.Map has the same field set as a seeded cue (guards field-drift)", () => {
  const doc = mkDoc([mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A" })]);
  insertCue(doc, "a");
  const yArr = doc.getArray<Y.Map<unknown>>(CUES_ARRAY_KEY);
  expect(new Set(yArr.get(1)!.keys())).toEqual(new Set(yArr.get(0)!.keys()));
});

test("insertCue renumbers orderIndex to array index", () => {
  const doc = mkDoc([
    mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A" }),
    mkSeed({ id: "b", orderIndex: 1, startMs: 2000, endMs: 3000, text: "B" }), // gap so insert-after-a uses open time
  ]);
  insertCue(doc, "a");
  expect(liveCuesFromDoc(doc).map((c) => c.orderIndex)).toEqual([0, 1, 2]);
});

// --- SFM-56 deleteCue ---
test("deleteCue removes the cue and renumbers orderIndex, leaving other cues intact", () => {
  const doc = mkDoc([
    mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A" }),
    mkSeed({ id: "b", orderIndex: 1, startMs: 1000, endMs: 2000, text: "B" }),
    mkSeed({ id: "c", orderIndex: 2, startMs: 2000, endMs: 3000, text: "C" }),
  ]);
  expect(deleteCue(doc, "b")).toEqual({ ok: true });
  const cues = liveCuesFromDoc(doc);
  expect(cues.map((c) => c.id)).toEqual(["a", "c"]);
  expect(cues.map((c) => c.orderIndex)).toEqual([0, 1]);
  expect(cues[1]!.startMs).toBe(2000); // c untouched
  expect(cues[1]!.endMs).toBe(3000);
  expect(cues[1]!.text).toBe("C");
});

test("deleteCue can remove the last remaining cue, leaving an empty list", () => {
  const doc = mkDoc([mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A" })]);
  expect(deleteCue(doc, "a")).toEqual({ ok: true });
  expect(liveCuesFromDoc(doc).length).toBe(0);
});

test("deleteCue returns not-found for an unknown id", () => {
  const doc = mkDoc([mkSeed({ id: "a", orderIndex: 0, startMs: 0, endMs: 1000, text: "A" })]);
  expect(deleteCue(doc, "nope")).toEqual({ ok: false, reason: "not-found" });
  expect(liveCuesFromDoc(doc).length).toBe(1);
});
