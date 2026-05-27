/**
 * Extract the Better Auth session token from the document's cookies.
 * Returns null if the cookie isn't present (anonymous).
 *
 * The cookie value may be "<token>" or "<token>.<signature>"; we return
 * the entire value and let the collab server split on "." for lookup.
 */
export function readSessionToken(): string | null {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie.split(";");
  for (const c of cookies) {
    const trimmed = c.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const name = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (name === "better-auth.session_token") {
      return decodeURIComponent(value);
    }
  }
  return null;
}
