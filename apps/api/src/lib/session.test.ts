import { afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { Hono } from "hono";
import { attachSession, requireSession, type AuthVariables } from "./session";
import * as authModule from "./auth";

type AppEnv = { Variables: AuthVariables };

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use("*", attachSession);
  app.get("/me", (c) => c.json({ user: c.get("user"), session: c.get("session") }));
  app.get("/private", requireSession, (c) => c.json({ ok: true }));
  return app;
}

const mockGetSession = mock();

beforeEach(() => {
  mockGetSession.mockReset();
  (authModule.auth.api.getSession as unknown) = mockGetSession;
});

afterEach(() => {
  mockGetSession.mockReset();
});

describe("attachSession", () => {
  test("sets user/session to null when no cookie is present (intent: unauthenticated requests still reach handlers)", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await app.request("/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: unknown; session: unknown };
    expect(body.user).toBeNull();
    expect(body.session).toBeNull();
  });

  test("populates user + session from auth.api.getSession on valid cookie (intent: handlers can read c.get('user'))", async () => {
    const fakeUser = { id: "u1", handle: "jurgen", email: "j@example.com" };
    const fakeSession = { id: "s1", userId: "u1", token: "tok", expiresAt: new Date(Date.now() + 3600_000) };
    mockGetSession.mockResolvedValueOnce({ user: fakeUser, session: fakeSession });

    const app = buildApp();
    const res = await app.request("/me", { headers: { cookie: "better-auth.session_token=tok" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: typeof fakeUser; session: { id: string } };
    expect(body.user.handle).toBe("jurgen");
    expect(body.session.id).toBe("s1");
  });
});

describe("requireSession", () => {
  test("returns 401 with error: 'unauthorized' when user is null (intent: gated routes do NOT leak data)", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await app.request("/private");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  test("calls next() and returns 200 when user is present (intent: authed requests pass through)", async () => {
    const fakeUser = { id: "u1", handle: "jurgen", email: "j@example.com" };
    const fakeSession = { id: "s1", userId: "u1", token: "tok", expiresAt: new Date(Date.now() + 3600_000) };
    mockGetSession.mockResolvedValueOnce({ user: fakeUser, session: fakeSession });

    const app = buildApp();
    const res = await app.request("/private", { headers: { cookie: "better-auth.session_token=tok" } });
    expect(res.status).toBe(200);
  });
});
