import type { LayoutServerLoad } from "./$types";

const API_URL = process.env.PUBLIC_API_URL ?? "http://localhost:3000";

export const load: LayoutServerLoad = async ({ request, fetch }) => {
  const cookie = request.headers.get("cookie") ?? "";

  try {
    const res = await fetch(`${API_URL}/api/auth/get-session`, {
      headers: { cookie },
    });
    if (!res.ok) return { session: null };
    const data = (await res.json()) as { user?: unknown; session?: unknown } | null;
    return { session: data };
  } catch {
    return { session: null };
  }
};
