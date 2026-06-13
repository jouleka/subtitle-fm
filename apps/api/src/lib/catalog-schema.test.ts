import { describe, expect, test } from "bun:test";
import { parseCatalog } from "./catalog-schema";

const ep = (number: number, sourceUrl = "https://ex.com/v.mp4") => ({ number, sourceUrl });
const show = (over: Record<string, unknown> = {}) => ({
  id: "show-a",
  title: "Show A",
  slug: "show-a",
  episodes: [ep(1)],
  ...over,
});

describe("parseCatalog", () => {
  test("parses a valid manifest and applies per-episode language defaults", () => {
    const shows = parseCatalog(JSON.stringify([show()]));
    expect(shows.length).toBe(1);
    expect(shows[0]!.id).toBe("show-a");
    // defaults exist so ingest never has to special-case missing langs
    expect(shows[0]!.episodes[0]!.sourceLanguage).toBe("ja");
    expect(shows[0]!.episodes[0]!.targetLanguage).toBe("en");
  });

  test("rejects non-JSON input", () => {
    expect(() => parseCatalog("{not json")).toThrow();
  });

  test("rejects an empty manifest (intent: a run must carry work)", () => {
    expect(() => parseCatalog("[]")).toThrow();
  });

  test("rejects a show with no episodes (intent: parity with the bulk endpoint's min(1))", () => {
    expect(() => parseCatalog(JSON.stringify([show({ episodes: [] })]))).toThrow();
  });

  test("rejects a missing required episode field (sourceUrl)", () => {
    expect(() => parseCatalog(JSON.stringify([show({ episodes: [{ number: 1 }] })]))).toThrow();
  });

  test("rejects a non-URL sourceUrl", () => {
    expect(() => parseCatalog(JSON.stringify([show({ episodes: [ep(1, "not-a-url")] })]))).toThrow();
  });

  test("rejects duplicate show ids in one manifest (intent: ambiguous re-ingest)", () => {
    const m = JSON.stringify([show({ id: "dup", slug: "a" }), show({ id: "dup", slug: "b" })]);
    expect(() => parseCatalog(m)).toThrow();
  });

  test("rejects duplicate episode numbers within a show (intent: a dup number with a different sourceUrl would be silently dropped at insert)", () => {
    const m = JSON.stringify([show({ episodes: [ep(1, "https://ex.com/1.mp4"), ep(1, "https://ex.com/2.mp4")] })]);
    expect(() => parseCatalog(m)).toThrow();
  });

  test("rejects an empty-string external id (intent: '' would spuriously collide on the unique index)", () => {
    expect(() => parseCatalog(JSON.stringify([show({ malId: "" })]))).toThrow();
  });
});
