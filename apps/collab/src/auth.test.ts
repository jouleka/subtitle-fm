import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { authenticateToken } from "./auth";
import { db } from "./db";
import { schema } from "@subtitle-fm/db";
import { inArray, eq } from "drizzle-orm";

const USER_ID = "55555555-5555-5555-5555-555555555551";
const VALID_TOKEN = "test-token-sfm25-valid";
const EXPIRED_TOKEN = "test-token-sfm25-expired";

async function cleanup() {
  await db.delete(schema.sessions).where(inArray(schema.sessions.token, [VALID_TOKEN, EXPIRED_TOKEN]));
  await db.delete(schema.users).where(eq(schema.users.id, USER_ID));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(schema.users).values({
    id: USER_ID,
    discordId: "discord-sfm25-auth",
    handle: "sfm25-auth-user",
    email: "sfm25-auth@example.com",
    emailVerified: false,
  });
  await db.insert(schema.sessions).values([
    {
      userId: USER_ID,
      token: VALID_TOKEN,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    },
    {
      userId: USER_ID,
      token: EXPIRED_TOKEN,
      expiresAt: new Date(Date.now() - 60 * 1000),
    },
  ]);
});

afterAll(async () => {
  await cleanup();
});

describe("authenticateToken", () => {
  test("returns user for a valid bare token (intent: happy path)", async () => {
    const user = await authenticateToken(VALID_TOKEN);
    expect(user.id).toBe(USER_ID);
    expect(user.handle).toBe("sfm25-auth-user");
  });

  test("accepts <token>.<signature> form by splitting on first dot (intent: Better Auth signed cookie)", async () => {
    const user = await authenticateToken(`${VALID_TOKEN}.fake-hmac-signature`);
    expect(user.id).toBe(USER_ID);
  });

  test("rejects unknown token (intent: no anonymous connections)", async () => {
    await expect(authenticateToken("nonexistent-token-sfm25")).rejects.toThrow("invalid session");
  });

  test("rejects expired token (intent: session expiry enforced server-side)", async () => {
    await expect(authenticateToken(EXPIRED_TOKEN)).rejects.toThrow("session expired");
  });

  test("rejects empty token (intent: bare token required)", async () => {
    await expect(authenticateToken("")).rejects.toThrow("missing token");
  });
});
