import { describe, expect, test } from "bun:test";
import { CreateGlossaryTerm, UpdateGlossaryTerm } from "./glossary";

describe("CreateGlossaryTerm", () => {
  test("accepts a valid term with notes omitted (intent: notes is optional metadata)", () => {
    expect(CreateGlossaryTerm.safeParse({ sourceText: "先輩", targetText: "senpai", kind: "honorific" }).success).toBe(true);
  });
  test("rejects empty sourceText (intent: a term needs something to match)", () => {
    expect(CreateGlossaryTerm.safeParse({ sourceText: "", targetText: "x", kind: "term" }).success).toBe(false);
  });
  test("rejects empty targetText (intent: a term needs a translation to insert)", () => {
    expect(CreateGlossaryTerm.safeParse({ sourceText: "x", targetText: "", kind: "term" }).success).toBe(false);
  });
  test("rejects an unknown kind (intent: kind is a closed enum)", () => {
    expect(CreateGlossaryTerm.safeParse({ sourceText: "x", targetText: "y", kind: "verb" }).success).toBe(false);
  });
});

describe("UpdateGlossaryTerm", () => {
  test("accepts a partial update (intent: PATCH changes a subset)", () => {
    expect(UpdateGlossaryTerm.safeParse({ targetText: "new" }).success).toBe(true);
  });
  test("accepts notes:null (intent: clearing notes is a real update)", () => {
    expect(UpdateGlossaryTerm.safeParse({ notes: null }).success).toBe(true);
  });
  test("rejects an empty body (intent: empty PATCH must 400, never reach Drizzle .set({}) -> 500)", () => {
    expect(UpdateGlossaryTerm.safeParse({}).success).toBe(false);
  });
  test("rejects empty targetText (intent: cannot blank out a translation)", () => {
    expect(UpdateGlossaryTerm.safeParse({ targetText: "" }).success).toBe(false);
  });
});
