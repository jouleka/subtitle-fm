import type { Context, Next } from "hono";
import { auth } from "./auth";

export type AuthUser = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>["user"];
export type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>["session"];

export type AuthVariables = {
  user: AuthUser | null;
  session: AuthSession | null;
};

export async function attachSession(
  c: Context<{ Variables: AuthVariables }>,
  next: Next,
) {
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("user", result?.user ?? null);
  c.set("session", result?.session ?? null);
  await next();
}

export async function requireSession(
  c: Context<{ Variables: AuthVariables }>,
  next: Next,
) {
  if (!c.get("user")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
}
