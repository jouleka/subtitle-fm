import type { LayoutServerLoad } from "./$types";
import { PUBLIC_API_URL } from "$env/static/public";

interface GetSessionResponse {
  user: { id: string; name: string | null; email: string | null; image: string | null };
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
    return {
      session: {
        user: body.user,
      },
    };
  } catch {
    return { session: null };
  }
};
