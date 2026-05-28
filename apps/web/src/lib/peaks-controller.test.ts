import { describe, expect, test } from "bun:test";
import { diffCueSegments, type CueInput } from "./peaks-controller";

const cue = (overrides: Partial<CueInput> & { id: string }): CueInput => ({
  startMs: 0,
  endMs: 1000,
  needsReview: false,
  ...overrides,
});

describe("diffCueSegments", () => {
  test("empty current + empty wanted yields empty diff (intent: the editor can call setCues before any cue is loaded without corrupting peaks state)", () => {
    expect(diffCueSegments([], [])).toEqual({ adds: [], updates: [], removes: [] });
  });

  test("adds a segment for each wanted cue not already present (intent: new Y.Doc cues materialize on the waveform)", () => {
    const diff = diffCueSegments([], [cue({ id: "a", startMs: 0, endMs: 1000 })]);
    expect(diff.removes).toEqual([]);
    expect(diff.updates).toEqual([]);
    expect(diff.adds).toHaveLength(1);
    expect(diff.adds[0]).toMatchObject({
      id: "a",
      startTime: 0,
      endTime: 1,
      editable: true,
      labelText: "",
    });
  });

  test("removes segments whose cue ids are gone from the wanted list (intent: deleted cues drop from the waveform)", () => {
    const diff = diffCueSegments(
      [{ id: "a" }, { id: "b" }],
      [cue({ id: "a" })],
    );
    expect(diff.removes).toEqual(["b"]);
    expect(diff.adds).toEqual([]);
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0]!.id).toBe("a");
  });

  test("emits an update for each cue still present (intent: Y.Doc field changes propagate to peaks)", () => {
    const diff = diffCueSegments([{ id: "a" }], [cue({ id: "a", startMs: 500, endMs: 1500 })]);
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0]).toEqual({
      id: "a",
      props: { startTime: 0.5, endTime: 1.5, color: "#5e95d6" },
    });
  });

  test("mixed add+update+remove returns all three buckets (intent: simultaneous Y.Doc edits land in a single setCues call)", () => {
    const diff = diffCueSegments(
      [{ id: "stale" }, { id: "kept" }],
      [
        cue({ id: "kept", startMs: 0, endMs: 1000 }),
        cue({ id: "fresh", startMs: 2000, endMs: 3000 }),
      ],
    );
    expect(diff.removes).toEqual(["stale"]);
    expect(diff.adds).toHaveLength(1);
    expect(diff.adds[0]!.id).toBe("fresh");
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0]!.id).toBe("kept");
  });

  test("needsReview=true colours the segment yellow on both add and update (intent: waveform mirrors the cue-list review badge)", () => {
    const addDiff = diffCueSegments([], [cue({ id: "a", needsReview: true })]);
    expect(addDiff.adds[0]!.color).toBe("#f4b400");

    const updateDiff = diffCueSegments([{ id: "a" }], [cue({ id: "a", needsReview: true })]);
    expect(updateDiff.updates[0]!.props.color).toBe("#f4b400");
  });

  test("ignores current segments without an id (intent: peaks.js may produce intermediate segments during a drag; we only own cue-keyed ones)", () => {
    const diff = diffCueSegments([{ id: undefined }, { id: "a" }], [cue({ id: "a" })]);
    expect(diff.removes).toEqual([]);
    expect(diff.adds).toEqual([]);
    expect(diff.updates).toHaveLength(1);
  });
});
