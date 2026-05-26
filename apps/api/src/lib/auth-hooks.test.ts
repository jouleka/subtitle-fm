import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "./db";
import { schema } from "@subtitle-fm/db";
import { eq, inArray } from "drizzle-orm";
import { resolveHandleConflict } from "./auth";

const TAKEN_HANDLE = "conflict-test-sfm20";
const ID_1 = "33333333-3333-3333-3333-333333333331";
const ID_2 = "33333333-3333-3333-3333-333333333332";

beforeAll(async () => {
  // Seed one user occupying TAKEN_HANDLE.
  await db.insert(schema.users).values({
    id: ID_1,
    handle: TAKEN_HANDLE,
    email: "conflict1-sfm20@example.com",
    discordId: "discord-conflict-sfm20-1",
    emailVerified: false,
  }).onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(schema.users).where(inArray(schema.users.id, [ID_1, ID_2]));
  await db.delete(schema.users).where(eq(schema.users.handle, `${TAKEN_HANDLE}-2`));
});

describe("resolveHandleConflict", () => {
  test("returns the input unchanged when the handle is free (intent: no-op on the happy path)", async () => {
    const out = await resolveHandleConflict("brand-new-handle-sfm20");
    expect(out).toBe("brand-new-handle-sfm20");
  });

  test("appends -2 when the base handle is taken (intent: avoid unique-index violation)", async () => {
    const out = await resolveHandleConflict(TAKEN_HANDLE);
    expect(out).toBe(`${TAKEN_HANDLE}-2`);
  });

  test("appends -3 when -2 is also taken (intent: monotone suffix)", async () => {
    // Seed -2 to occupy that slot too.
    await db.insert(schema.users).values({
      id: ID_2,
      handle: `${TAKEN_HANDLE}-2`,
      email: "conflict2-sfm20@example.com",
      discordId: "discord-conflict-sfm20-2",
      emailVerified: false,
    }).onConflictDoNothing();

    const out = await resolveHandleConflict(TAKEN_HANDLE);
    expect(out).toBe(`${TAKEN_HANDLE}-3`);
  });
});
