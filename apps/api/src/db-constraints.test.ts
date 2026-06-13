import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "./lib/db";
import { schema } from "@subtitle-fm/db";
import { eq, inArray } from "drizzle-orm";

// Cover every external-id column, not just one — a wrong/non-unique index on
// any of them would otherwise slip through (final-review Rule-9 note).
const EXTERNAL_ID_COLS = ["imdbId", "malId", "anilistId", "kitsuId"] as const;
const NULL_IDS = ["sfm64-n1", "sfm64-n2"];
const IDS = [
  ...EXTERNAL_ID_COLS.flatMap((c) => [`sfm64-${c}-a`, `sfm64-${c}-b`]),
  ...NULL_IDS,
];

beforeAll(async () => {
  await db.delete(schema.shows).where(inArray(schema.shows.id, IDS));
});
afterAll(async () => {
  await db.delete(schema.shows).where(inArray(schema.shows.id, IDS));
});

describe("shows external-id uniqueness (SFM-64)", () => {
  // Distinct id + slug per row (both are independently unique) so a rejection is
  // provably from the external-id index under test, not the PK or slug index.
  for (const col of EXTERNAL_ID_COLS) {
    test(`rejects a duplicate non-null ${col}`, async () => {
      const aId = `sfm64-${col}-a`;
      const bId = `sfm64-${col}-b`;
      const val = `sfm64-dup-${col}`;
      const a: typeof schema.shows.$inferInsert = { id: aId, title: aId, slug: aId };
      a[col] = val;
      await db.insert(schema.shows).values(a);
      // Explicit try/catch: drizzle's insert builder is a lazy thenable that
      // expect().rejects does not reliably await, so assert the throw directly.
      const b: typeof schema.shows.$inferInsert = { id: bId, title: bId, slug: bId };
      b[col] = val;
      let threw = false;
      try {
        await db.insert(schema.shows).values(b);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  }

  test("allows multiple shows with all external ids NULL", async () => {
    await db.insert(schema.shows).values({ id: "sfm64-n1", title: "n1", slug: "sfm64-n1" });
    await db.insert(schema.shows).values({ id: "sfm64-n2", title: "n2", slug: "sfm64-n2" });
    const rows = await db
      .select({ id: schema.shows.id })
      .from(schema.shows)
      .where(inArray(schema.shows.id, NULL_IDS));
    expect(rows.length).toBe(2);
  });
});

describe("seasons (SFM-63)", () => {
  const SHOW = "sfm63-show";
  beforeAll(async () => {
    await db.delete(schema.shows).where(eq(schema.shows.id, SHOW));
    await db.insert(schema.shows).values({ id: SHOW, title: "s63", slug: "sfm63-show" });
  });
  afterAll(async () => {
    // deleting the show cascades to its seasons + episodes (FK onDelete cascade)
    await db.delete(schema.shows).where(eq(schema.shows.id, SHOW));
  });

  // Both inserts omit `id` (defaultRandom → distinct PKs) and share (showId, number),
  // so a rejection is provably from seasons_show_number_idx, not the PK.
  test("rejects a duplicate (showId, number) season", async () => {
    await db.insert(schema.seasons).values({ showId: SHOW, number: 1, title: "S1" });
    let threw = false;
    try {
      await db.insert(schema.seasons).values({ showId: SHOW, number: 1, title: "dup" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("an episode can link a season, and seasonId may be null", async () => {
    const [s] = await db
      .insert(schema.seasons)
      .values({ showId: SHOW, number: 2, title: "S2" })
      .returning({ id: schema.seasons.id });
    const [linked] = await db
      .insert(schema.episodes)
      .values({ showId: SHOW, number: 1, seasonId: s!.id })
      .returning({ seasonId: schema.episodes.seasonId });
    expect(linked!.seasonId).toBe(s!.id);
    const [unlinked] = await db
      .insert(schema.episodes)
      .values({ showId: SHOW, number: 2 })
      .returning({ seasonId: schema.episodes.seasonId });
    expect(unlinked!.seasonId).toBeNull();
  });
});

describe("episodes (show_id, number) uniqueness (bulk-ingest)", () => {
  // Bulk ingestion leans on the DB to dedup (onConflictDoNothing), not the old
  // app-level SELECT-then-409 (a TOCTOU race under concurrent batches). These
  // tests encode that (show_id, number) is a hard DB invariant.
  const SHOW = "sfm-epuniq-show";
  const SHOW2 = "sfm-epuniq-show2";
  beforeAll(async () => {
    await db.delete(schema.shows).where(inArray(schema.shows.id, [SHOW, SHOW2]));
    await db.insert(schema.shows).values({ id: SHOW, title: "epuniq", slug: "sfm-epuniq-show" });
    await db.insert(schema.shows).values({ id: SHOW2, title: "epuniq2", slug: "sfm-epuniq-show2" });
  });
  afterAll(async () => {
    // deleting the shows cascades to their episodes (FK onDelete cascade)
    await db.delete(schema.shows).where(inArray(schema.shows.id, [SHOW, SHOW2]));
  });

  test("rejects a duplicate (show_id, number) episode (intent: dedup is a DB invariant bulk relies on)", async () => {
    await db.insert(schema.episodes).values({ showId: SHOW, number: 1 });
    let threw = false;
    try {
      await db.insert(schema.episodes).values({ showId: SHOW, number: 1 });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("allows the same number across different shows (intent: episode numbering is per-show)", async () => {
    await db.insert(schema.episodes).values({ showId: SHOW, number: 5 });
    const [ep] = await db
      .insert(schema.episodes)
      .values({ showId: SHOW2, number: 5 })
      .returning({ id: schema.episodes.id });
    expect(ep!.id).toBeTruthy();
  });
});
