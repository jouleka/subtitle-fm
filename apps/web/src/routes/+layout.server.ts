import type { LayoutServerLoad } from "./$types";
import { PUBLIC_API_URL } from "$env/static/public";

interface GetSessionResponse {
  user: { id: string; name: string | null; email: string | null; image: string | null };
  session: { id: string; userId: string; token: string; expiresAt: string };
}

export const load: LayoutServerLoad = async ({ request, fetch }) => {
  const cookie = request.headers.get("cookie") ?? "";

  try {
    const res = await fetch(`${PUBLIC_API_URL}/api/auth/get-session`, {
      headers: { cookie },
    });
    if (!res.ok) return { session: null };
    const body = (await res.json()) as GetSessionResponse | null;
    if (!body) return { session: null };
    // Flatten the response. We expose the session token here because the
    // Better Auth cookie is httpOnly — the client can't read it directly, but
    // the collab WebSocket auth needs the bare token. SSR is the only path.
    return {
      session: {
        user: body.user,
        token: body.session.token,
      },
    };
  } catch {
    return { session: null };
  }
};
