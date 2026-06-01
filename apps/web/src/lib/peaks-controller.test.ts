import { describe, expect, test } from "bun:test";
import { diffCueSegments, peaksInitShouldRetry, type CueInput, type SegmentSnapshot } from "./peaks-controller";

const cue = (overrides: Partial<CueInput> & { id: string }): CueInput => ({
  startMs: 0,
  endMs: 1000,
  needsReview: false,
  ...overrides,
});

// A peaks.js segment snapshot whose rendered props exactly match a cue —
// i.e. the segment is already drawn correctly for that cue.
const segFor = (c: CueInput): SegmentSnapshot => ({
  id: c.id,
  startTime: c.startMs / 1000,
  endTime: c.endMs / 1000,
  color: c.needsReview ? "#f4b400" : "#5e95d6",
});

describe("diffCueSegments", () => {
  test("empty current + empty wanted yields empty diff (intent: the editor can call setCues before any cue is loaded without corrupting peaks state)", () => {
    expect(diffCueSegments([], [])).toEqual({ adds: [], removes: [] });
  });

  test("adds a segment for each wanted cue not already present (intent: new Y.Doc cues materialize on the waveform)", () => {
    const diff = diffCueSegments([], [cue({ id: "a", startMs: 0, endMs: 1000 })]);
    expect(diff.removes).toEqual([]);
    expect(diff.adds).toHaveLength(1);
    expect(diff.adds[0]).toMatchObject({
      id: "a",
      startTime: 0,
      endTime: 1,
      editable: true,
      labelText: "",
    });
  });

  test("leaves an unchanged segment untouched (intent: setCues is idempotent so re-renders don't flicker every segment)", () => {
    const c = cue({ id: "a", startMs: 500, endMs: 1500 });
    const diff = diffCueSegments([segFor(c)], [c]);
    expect(diff).toEqual({ adds: [], removes: [] });
  });

  test("removes segments whose cue ids are gone from the wanted list (intent: deleted cues drop from the waveform)", () => {
    const a = cue({ id: "a" });
    const b = cue({ id: "b" });
    const diff = diffCueSegments([segFor(a), segFor(b)], [a]);
    expect(diff.removes).toEqual(["b"]);
    expect(diff.adds).toEqual([]);
  });

  test("a retimed cue is removed and re-added, not updated (intent: peaks.js Segment.update mutates data but never repaints, so we force a structural redraw)", () => {
    const before = segFor(cue({ id: "a", startMs: 0, endMs: 1000 }));
    const after = cue({ id: "a", startMs: 0, endMs: 2000 });
    const diff = diffCueSegments([before], [after]);
    expect(diff.removes).toEqual(["a"]);
    expect(diff.adds).toHaveLength(1);
    expect(diff.adds[0]).toMatchObject({ id: "a", startTime: 0, endTime: 2 });
  });

  test("a needsReview toggle is removed and re-added with the new colour (intent: the review-flag colour change must actually repaint, mirroring the cue-list badge)", () => {
    const before = segFor(cue({ id: "a", needsReview: false }));
    const after = cue({ id: "a", needsReview: true });
    const diff = diffCueSegments([before], [after]);
    expect(diff.removes).toEqual(["a"]);
    expect(diff.adds).toHaveLength(1);
    expect(diff.adds[0]!.color).toBe("#f4b400");
  });

  test("mixed new+changed+stale+unchanged routes each cue correctly (intent: one diff handles all transitions from a single setCues call)", () => {
    const kept = cue({ id: "kept", startMs: 0, endMs: 1000 });
    const changed = cue({ id: "changed", startMs: 0, endMs: 1000 });
    const diff = diffCueSegments(
      [segFor(kept), segFor(changed), segFor(cue({ id: "stale" }))],
      [
        kept, // unchanged → untouched
        cue({ id: "changed", startMs: 0, endMs: 2500 }), // retimed → remove+add
        cue({ id: "fresh", startMs: 3000, endMs: 4000 }), // new → add
      ],
    );
    expect(diff.removes.sort()).toEqual(["changed", "stale"]);
    expect(diff.adds.map((a) => a.id).sort()).toEqual(["changed", "fresh"]);
  });

  test("ignores current segments without an id (intent: peaks.js may produce transient id-less segments mid-drag that we don't own)", () => {
    const a = cue({ id: "a" });
    const diff = diffCueSegments([{ id: undefined }, segFor(a)], [a]);
    expect(diff.removes).toEqual([]);
    expect(diff.adds).toEqual([]);
  });
});

describe("peaksInitShouldRetry", () => {
  test("retries when the container is hidden and under the cap (the visibility race)", () => {
    expect(peaksInitShouldRetry(true, 0, 3)).toBe(true);
    expect(peaksInitShouldRetry(true, 2, 3)).toBe(true);
  });
  test("does not retry a still-visible container (genuine, non-transient error)", () => {
    expect(peaksInitShouldRetry(false, 0, 3)).toBe(false);
  });
  test("does not retry once the cap is reached", () => {
    expect(peaksInitShouldRetry(true, 3, 3)).toBe(false);
    expect(peaksInitShouldRetry(true, 4, 3)).toBe(false);
  });
});
