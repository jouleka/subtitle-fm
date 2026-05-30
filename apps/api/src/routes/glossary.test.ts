import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { app } from "../index";
import { db } from "../lib/db";
import { schema } from "@subtitle-fm/db";
import { eq } from "drizzle-orm";
import * as authModule from "../lib/auth";

const TEST_SHOW_ID = "test-show-sfm28-glossary";
const FAKE_USER = { id: "33333333-3333-3333-3333-333333333333", handle: "test-user-sfm28", email: "test-sfm28@example.com" };
const FAKE_SESSION = { id: "44444444-4444-4444-4444-444444444444", userId: FAKE_USER.id, token: "test-token-sfm28", expiresAt: new Date(Date.now() + 24 * 3600 * 1000) };

const mockGetSession = mock();
const base = `/shows/${TEST_SHOW_ID}/glossary`;
const authed = () => mockGetSession.mockResolvedValueOnce({ user: FAKE_USER, session: FAKE_SESSION });
const anon = () => mockGetSession.mockResolvedValueOnce(null);
const jsonReq = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

async function cleanup() {
  await db.delete(schema.glossaryTerms).where(eq(schema.glossaryTerms.showId, TEST_SHOW_ID));
  await db.delete(schema.shows).where(eq(schema.shows.id, TEST_SHOW_ID));
}

beforeAll(async () => {
  await cleanup();
  (authModule.auth.api.getSession as unknown) = mockGetSession;
  await db.insert(schema.shows).values({ id: TEST_SHOW_ID, title: "Test Show SFM-28", slug: "test-show-sfm-28-glossary" }).onConflictDoNothing();
});
afterAll(async () => { await cleanup(); });
beforeEach(() => mockGetSession.mockReset());
afterEach(() => mockGetSession.mockReset());

describe("glossary CRUD", () => {
  test("POST without a session returns 401 (intent: gated mutation refuses anon)", async () => {
    anon();
    const res = await jsonReq("POST", base, { sourceText: "x", targetText: "y", kind: "term" });
    expect(res.status).toBe(401);
  });

  test("POST creates a term (201) and GET lists it (intent: panel reads a show's terms)", async () => {
    authed();
    const created = await jsonReq("POST", base, { sourceText: "先輩", targetText: "senpai", kind: "honorific" });
    expect(created.status).toBe(201);
    expect(((await created.json()) as { sourceText: string }).sourceText).toBe("先輩");
    const list = await app.request(base);
    expect(list.status).toBe(200);
    const body = (await list.json()) as { glossaryTerms: Array<{ sourceText: string }> };
    expect(body.glossaryTerms.some((t) => t.sourceText === "先輩")).toBe(true);
  });

  test("POST a duplicate sourceText returns 409 (intent: unique per show, surfaced cleanly)", async () => {
    authed();
    await jsonReq("POST", base, { sourceText: "dup", targetText: "a", kind: "term" });
    authed();
    const res = await jsonReq("POST", base, { sourceText: "dup", targetText: "b", kind: "term" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("duplicate_source");
  });

  test("PATCH with an empty body returns 400, not 500 (intent: empty update must not reach Drizzle .set({}))", async () => {
    authed();
    const created = await jsonReq("POST", base, { sourceText: "to-patch-empty", targetText: "a", kind: "term" });
    const { id } = (await created.json()) as { id: string };
    authed();
    const res = await jsonReq("PATCH", `${base}/${id}`, {});
    expect(res.status).toBe(400);
  });

  test("PATCH updates only the provided fields (intent: partial edit keeps sourceText)", async () => {
    authed();
    const created = await jsonReq("POST", base, { sourceText: "to-patch", targetText: "old", kind: "term" });
    const { id } = (await created.json()) as { id: string };
    authed();
    const res = await jsonReq("PATCH", `${base}/${id}`, { targetText: "new" });
    expect(res.status).toBe(200);
    const row = (await res.json()) as { targetText: string; sourceText: string };
    expect(row.targetText).toBe("new");
    expect(row.sourceText).toBe("to-patch");
  });

  test("PATCH a nonexistent term returns 404", async () => {
    authed();
    const res = await jsonReq("PATCH", `${base}/00000000-0000-0000-0000-000000000000`, { targetText: "x" });
    expect(res.status).toBe(404);
  });

  test("DELETE removes a term (200) then 404s when absent (intent: idempotent-ish delete)", async () => {
    authed();
    const created = await jsonReq("POST", base, { sourceText: "to-delete", targetText: "a", kind: "term" });
    const { id } = (await created.json()) as { id: string };
    authed();
    expect((await app.request(`${base}/${id}`, { method: "DELETE" })).status).toBe(200);
    authed();
    expect((await app.request(`${base}/${id}`, { method: "DELETE" })).status).toBe(404);
  });
});
