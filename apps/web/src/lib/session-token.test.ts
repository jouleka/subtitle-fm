import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readSessionToken } from "./session-token";

const originalDocument = globalThis.document;

beforeEach(() => {
  // Install a stub document object with a mutable cookie string.
  (globalThis as { document?: { cookie: string } }).document = { cookie: "" };
});

afterEach(() => {
  if (originalDocument) {
    (globalThis as { document?: unknown }).document = originalDocument;
  } else {
    delete (globalThis as { document?: unknown }).document;
  }
});

describe("readSessionToken", () => {
  test("returns null when no cookies are present (intent: anonymous gets no token)", () => {
    document.cookie = "";
    expect(readSessionToken()).toBeNull();
  });

  test("returns null when the specific cookie is missing (intent: only this app's cookie matters)", () => {
    document.cookie = "other-cookie=value; another=42";
    expect(readSessionToken()).toBeNull();
  });

  test("returns the cookie value when present alone (intent: happy path)", () => {
    document.cookie = "better-auth.session_token=abc123";
    expect(readSessionToken()).toBe("abc123");
  });

  test("returns the cookie value when surrounded by others (intent: order-independent)", () => {
    document.cookie = "foo=1; better-auth.session_token=abc.signed; bar=2";
    expect(readSessionToken()).toBe("abc.signed");
  });

  test("decodes URL-encoded value (intent: cookie values are URL-encoded by browsers)", () => {
    document.cookie = "better-auth.session_token=abc%2Edef";
    expect(readSessionToken()).toBe("abc.def");
  });
});
