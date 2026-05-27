import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import {
  CUES_ARRAY_KEY,
  cueMapToLive,
  hydrateCuesIntoDoc,
  liveCuesFromDoc,
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
