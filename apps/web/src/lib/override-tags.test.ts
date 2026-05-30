import { describe, expect, test } from "bun:test";
import { segmentOverrideTags, type Segment } from "./override-tags";

const join = (segs: Segment[]) => segs.map((s) => s.value).join("");

describe("segmentOverrideTags", () => {
  test("plain dialogue with no tags is one text segment (normal text renders unhighlighted)", () => {
    expect(segmentOverrideTags("Hello there")).toEqual([
      { kind: "text", value: "Hello there" },
    ]);
  });

  test("a tag in the middle splits text / tag / text (highlight lands exactly on the brace group)", () => {
    expect(segmentOverrideTags("Hi {\\i1}there")).toEqual([
      { kind: "text", value: "Hi " },
      { kind: "tag", value: "{\\i1}" },
      { kind: "text", value: "there" },
    ]);
  });

  test("a leading tag emits no empty text before it", () => {
    expect(segmentOverrideTags("{\\b1}Bold")).toEqual([
      { kind: "tag", value: "{\\b1}" },
      { kind: "text", value: "Bold" },
    ]);
  });

  test("a trailing tag emits no empty text after it", () => {
    expect(segmentOverrideTags("Bye{\\r}")).toEqual([
      { kind: "text", value: "Bye" },
      { kind: "tag", value: "{\\r}" },
    ]);
  });

  test("adjacent tags are two tag segments with no empty text between (no stray empty spans)", () => {
    expect(segmentOverrideTags("{\\b1}{\\i1}X")).toEqual([
      { kind: "tag", value: "{\\b1}" },
      { kind: "tag", value: "{\\i1}" },
      { kind: "text", value: "X" },
    ]);
  });

  test("an empty brace group {} is treated as a tag segment (the function does not filter empty groups)", () => {
    expect(segmentOverrideTags("a{}b")).toEqual([
      { kind: "text", value: "a" },
      { kind: "tag", value: "{}" },
      { kind: "text", value: "b" },
    ]);
  });

  test("a closed tag then a trailing unclosed brace keeps the unclosed tail as text", () => {
    expect(segmentOverrideTags("a{b}c{d")).toEqual([
      { kind: "text", value: "a" },
      { kind: "tag", value: "{b}" },
      { kind: "text", value: "c{d" },
    ]);
  });

  test("an unclosed brace is never highlighted and never swallows the rest of the line", () => {
    expect(segmentOverrideTags("{\\fad oops")).toEqual([
      { kind: "text", value: "{\\fad oops" },
    ]);
  });

  test("the empty string yields no segments (nothing to render)", () => {
    expect(segmentOverrideTags("")).toEqual([]);
  });

  test("surrogate pairs adjacent to a tag are not split (emoji survive segmentation)", () => {
    const segs = segmentOverrideTags("😀{\\i1}😁");
    expect(segs).toEqual([
      { kind: "text", value: "😀" },
      { kind: "tag", value: "{\\i1}" },
      { kind: "text", value: "😁" },
    ]);
  });

  // The make-or-break property: the backdrop renders these segment values
  // concatenated, so if join !== input the highlight drifts off the textarea's
  // glyphs. This must hold for EVERY input.
  test("join-invariant: concatenating segment values reproduces the input exactly", () => {
    const inputs = [
      "",
      "plain",
      "{\\i1}",
      "a{\\i1}b",
      "{\\b1}{\\i1}",
      "{}",
      "a{b}c{d",
      "{\\fad oops",
      "emoji 😀 {\\k20} 😁 tail",
      "全部{\\an8}日本語",
    ];
    for (const input of inputs) {
      expect(join(segmentOverrideTags(input))).toBe(input);
    }
  });
});
