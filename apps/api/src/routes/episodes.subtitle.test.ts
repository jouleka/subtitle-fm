import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { db } from "../lib/db";
import { schema } from "@subtitle-fm/db";
import { eq } from "drizzle-orm";

mock.module("../lib/r2", () => ({
  presignGet: mock(async () => "https://r2.example/presigned/published.srt"),
  putObject: mock(async () => {}),
  presignPut: mock(async () => ""),
  deleteObject: mock(async () => {}),
  R2_BUCKETS: {},
}));
const { app } = await import("../index");

const SHOW = "sfm59sub-show";
const EP_PUB = "59999999-1111-0000-0000-000000000001";
const EP_UNPUB = "59999999-1111-0000-0000-000000000002";

beforeAll(async () => {
  await db.delete(schema.episodes).where(eq(schema.episodes.showId, SHOW));
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW));
  await db.insert(schema.shows).values({ id: SHOW, title: "SFM-59 sub", slug: "sfm-59-sub" });
  await db.insert(schema.episodes).values({ id: EP_PUB, showId: SHOW, number: 1, title: "p", status: "published" });
  await db.insert(schema.episodes).values({ id: EP_UNPUB, showId: SHOW, number: 2, title: "u", status: "ready_for_edit" });
});
afterAll(async () => {
  await db.delete(schema.episodes).where(eq(schema.episodes.showId, SHOW));
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW));
});

describe("GET /episodes/:id/subtitle.srt", () => {
  test("302-redirects a published episode to the presigned R2 url", async () => {
    const res = await app.request(`/episodes/${EP_PUB}/subtitle.srt`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://r2.example/presigned/published.srt");
  });
  test("404 not_published for an unpublished episode", async () => {
    const res = await app.request(`/episodes/${EP_UNPUB}/subtitle.srt`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("not_published");
  });
  test("404 episode_not_found for an unknown id", async () => {
    const res = await app.request(`/episodes/00000000-0000-0000-0000-0000000000ff/subtitle.srt`);
    expect(res.status).toBe(404);
  });
});
