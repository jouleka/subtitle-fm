import { describe, expect, test } from "bun:test";
import { defaultParsedAss, type DefaultParsedAssInput } from "./defaults";
import { serializeAss } from "./serialize";

const seed: DefaultParsedAssInput = {
  id: "11111111-1111-1111-1111-111111111111",
  orderIndex: 0,
  startMs: 0,
  endMs: 1000,
  text: "hello",
  styleName: "Default",
  speakerId: null,
  rawOverrideTags: "",
};

describe("defaultParsedAss", () => {
  test("empty input still produces a populated header (intent: JASSUB needs ScriptType + style even without cues)", () => {
    const doc = defaultParsedAss([]);
    expect(doc.cues).toEqual([]);
    expect(doc.styles).toHaveLength(1);
    expect(doc.styles[0]!.Name).toBe("Default");
    expect(doc.info.ScriptType).toBe("v4.00+");
    expect(doc.info.PlayResX).toBe("1920");
    expect(doc.info.PlayResY).toBe("1080");
  });

  test("sorts cues by orderIndex ascending (intent: input may be unordered after CRDT merges)", () => {
    const doc = defaultParsedAss([
      { ...seed, id: "a", orderIndex: 2, text: "two" },
      { ...seed, id: "b", orderIndex: 0, text: "zero" },
      { ...seed, id: "c", orderIndex: 1, text: "one" },
    ]);
    expect(doc.cues.map((c) => c.text)).toEqual(["zero", "one", "two"]);
  });

  test("maps speakerId null to empty speaker string (intent: ASS speaker column cannot be null)", () => {
    const doc = defaultParsedAss([{ ...seed, speakerId: null }]);
    expect(doc.cues[0]!.speaker).toBe("");
  });

  test("maps speakerId value through to AssCue.speaker (intent: preserve speaker tagging)", () => {
    const doc = defaultParsedAss([{ ...seed, speakerId: "alice" }]);
    expect(doc.cues[0]!.speaker).toBe("alice");
  });

  test("falls back to 'Default' when styleName is empty (intent: cues missing style still render)", () => {
    const doc = defaultParsedAss([{ ...seed, styleName: "" }]);
    expect(doc.cues[0]!.styleName).toBe("Default");
  });

  test("output round-trips through serializeAss without throwing (intent: well-formedness)", () => {
    const doc = defaultParsedAss([seed]);
    const text = serializeAss(doc);
    expect(text.startsWith("[Script Info]")).toBe(true);
    expect(text).toContain("[V4+ Styles]");
    expect(text).toContain("[Events]");
    expect(text).toContain("hello");
  });
});
