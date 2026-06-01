import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "../lib/db";
import { schema } from "@subtitle-fm/db";
import { eq } from "drizzle-orm";
import { app } from "../index";

const SHOW = "sfm59-show";
const EP_PUB = "59999999-0000-0000-0000-000000000001";
const EP_UNPUB = "59999999-0000-0000-0000-000000000002";
const EP_JA = "59999999-0000-0000-0000-000000000007";

beforeAll(async () => {
  await db.delete(schema.episodes).where(eq(schema.episodes.showId, SHOW));
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW));
  await db.insert(schema.shows).values({ id: SHOW, title: "SFM-59", slug: "sfm-59", kitsuId: "kit59", imdbId: "tt59", malId: "mal59" });
  await db.insert(schema.episodes).values({ id: EP_PUB, showId: SHOW, number: 5, title: "pub", status: "published" });
  await db.insert(schema.episodes).values({ id: EP_UNPUB, showId: SHOW, number: 6, title: "unpub", status: "ready_for_edit" });
  await db.insert(schema.episodes).values({ id: EP_JA, showId: SHOW, number: 7, title: "ja", status: "published", targetLanguage: "ja" });
});
afterAll(async () => {
  await db.delete(schema.episodes).where(eq(schema.episodes.showId, SHOW));
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW));
});

describe("GET /stremio/subtitles/:type/:id", () => {
  test("kitsu id (colon-bearing) resolves a published episode to one .srt subtitle", async () => {
    const res = await app.request(`/stremio/subtitles/series/${encodeURIComponent("kitsu:kit59:5")}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subtitles: { id: string; url: string; lang: string }[] };
    expect(body.subtitles.length).toBe(1);
    expect(body.subtitles[0]!.url.endsWith(`/episodes/${EP_PUB}/subtitle.srt`)).toBe(true);
    expect(body.subtitles[0]!.lang).toBe("eng");
  });
  test("imdb + mal ids also resolve the published episode", async () => {
    for (const id of ["tt59:1:5", "mal:mal59:5"]) {
      const res = await app.request(`/stremio/subtitles/series/${encodeURIComponent(id)}`);
      expect(((await res.json()) as { subtitles: unknown[] }).subtitles.length).toBe(1);
    }
  });
  test("an unpublished episode yields no subtitles", async () => {
    const res = await app.request(`/stremio/subtitles/series/${encodeURIComponent("kitsu:kit59:6")}`);
    expect(((await res.json()) as { subtitles: unknown[] }).subtitles).toEqual([]);
  });
  test("an unknown external id yields no subtitles", async () => {
    const res = await app.request(`/stremio/subtitles/series/${encodeURIComponent("kitsu:nope:5")}`);
    expect(((await res.json()) as { subtitles: unknown[] }).subtitles).toEqual([]);
  });
  test("a movie type yields no subtitles", async () => {
    const res = await app.request(`/stremio/subtitles/movie/${encodeURIComponent("tt59")}`);
    expect(((await res.json()) as { subtitles: unknown[] }).subtitles).toEqual([]);
  });
  test("maps the episode targetLanguage to ISO-639-2 (ja -> jpn)", async () => {
    const res = await app.request(`/stremio/subtitles/series/${encodeURIComponent("kitsu:kit59:7")}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subtitles: { lang: string }[] };
    expect(body.subtitles.length).toBe(1);
    expect(body.subtitles[0]!.lang).toBe("jpn");
  });
});
