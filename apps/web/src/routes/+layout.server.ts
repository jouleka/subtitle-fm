import type { LayoutServerLoad } from "./$types";
import { PUBLIC_API_URL } from "$env/static/public";

export const load: LayoutServerLoad = async ({ request, fetch }) => {
  const cookie = request.headers.get("cookie") ?? "";

  try {
    const res = await fetch(`${PUBLIC_API_URL}/api/auth/get-session`, {
      headers: { cookie },
    });
    if (!res.ok) return { session: null };
    const data = (await res.json()) as { user?: unknown; session?: unknown } | null;
    return { session: data };
  } catch {
    return { session: null };
  }
};
