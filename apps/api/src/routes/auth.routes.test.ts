import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { app } from "../index";
import { db } from "../lib/db";
import { schema } from "@subtitle-fm/db";
import { eq, inArray } from "drizzle-orm";
import * as authModule from "../lib/auth";

const FAKE_USER_ID = "11111111-1111-1111-1111-111111111111";
const FAKE_SESSION_ID = "22222222-2222-2222-2222-222222222222";
const TEST_SHOW_ID = "test-show-sfm20-auth";
const FAKE_USER = {
  id: FAKE_USER_ID,
  handle: "test-user-sfm20",
  email: "test-sfm20@example.com",
};
const FAKE_SESSION = {
  id: FAKE_SESSION_ID,
  userId: FAKE_USER_ID,
  token: "test-token-sfm20",
  expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
};

const mockGetSession = mock();

async function cleanup() {
  // Clean episodes for the test show
  await db.delete(schema.episodes).where(eq(schema.episodes.showId, TEST_SHOW_ID));
  await db.delete(schema.shows).where(eq(schema.shows.id, TEST_SHOW_ID));
}

beforeAll(async () => {
  await cleanup(); // in case of stale state from a failed previous run
  (authModule.auth.api.getSession as unknown) = mockGetSession;

  // Seed a show so POST /episodes happy-path has a referent.
  await db.insert(schema.shows).values({
    id: TEST_SHOW_ID,
    title: "Test Show SFM-20",
    slug: "test-show-sfm-20-auth",
  }).onConflictDoNothing();
});

afterAll(async () => {
  await cleanup();
});

beforeEach(() => {
  mockGetSession.mockReset();
});

afterEach(() => {
  mockGetSession.mockReset();
});

describe("POST /shows", () => {
  test("returns 401 without a session (intent: gated mutation refuses anon)", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await app.request("/shows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "should-not-exist",
        title: "Nope",
        slug: "nope-show",
      }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  test("returns 201 with a valid session (intent: authed POSTs go through)", async () => {
    mockGetSession.mockResolvedValueOnce({ user: FAKE_USER, session: FAKE_SESSION });
    const uniqueId = `${TEST_SHOW_ID}-201`;
    const res = await app.request("/shows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: uniqueId,
        title: "Authed Test Show",
        slug: "authed-test-show-sfm-20",
      }),
    });
    expect(res.status).toBe(201);
    // cleanup the side-effect row
    await db.delete(schema.shows).where(eq(schema.shows.id, uniqueId));
  });
});

describe("GET /shows", () => {
  test("returns 200 without a session (intent: browsing stays public)", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await app.request("/shows");
    expect(res.status).toBe(200);
  });
});

describe("POST /episodes", () => {
  test("returns 401 without a session", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await app.request("/episodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        showId: TEST_SHOW_ID,
        number: 1,
        sourceUrl: "https://example.com/test.mp4",
      }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /episodes", () => {
  test("returns 200 without a session", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await app.request("/episodes");
    expect(res.status).toBe(200);
  });
});
