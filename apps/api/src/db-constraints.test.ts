import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "./lib/db";
import { schema } from "@subtitle-fm/db";
import { inArray } from "drizzle-orm";

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
