import { db } from "./db";
import { schema } from "@subtitle-fm/db";
import { eq } from "drizzle-orm";

export interface AuthedUser {
  id: string;
  handle: string;
}

/**
 * Validate a Better Auth session token against the sessions table.
 * Accepts the bare token or "<token>.<signature>" — the dot-suffix
 * (Better Auth's HMAC tamper-protection) is ignored because the random
 * token itself is the security primitive (256-bit UUID).
 */
export async function authenticateToken(token: string): Promise<AuthedUser> {
  const bareToken = token.split(".")[0];
  if (!bareToken) throw new Error("missing token");

  const rows = await db
    .select({
      userId: schema.sessions.userId,
      expiresAt: schema.sessions.expiresAt,
      handle: schema.users.handle,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(eq(schema.sessions.token, bareToken))
    .limit(1);

  const session = rows[0];
  if (!session) throw new Error("invalid session");
  if (session.expiresAt.getTime() < Date.now()) throw new Error("session expired");

  return { id: session.userId, handle: session.handle };
}
