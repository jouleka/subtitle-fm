import type { PageServerLoad } from "./$types";
import { error, redirect } from "@sveltejs/kit";
import { PUBLIC_API_URL } from "$env/static/public";
import type { Cue, Episode } from "$lib/types";
import type { GlossaryTerm } from "@subtitle-fm/shared";

export const load: PageServerLoad = async ({ params, fetch, parent, request }) => {
  const { session } = await parent();
  if (!session?.user) {
    throw redirect(302, "/");
  }

  const cookie = request.headers.get("cookie") ?? "";
  const epRes = await fetch(`${PUBLIC_API_URL}/episodes/${params.id}`, { headers: { cookie } });
  if (epRes.status === 404) throw error(404, "Episode not found");
  if (!epRes.ok) throw error(epRes.status, "Failed to load episode");
  const episode = (await epRes.json()) as Episode;

  const [cuesRes, glossaryRes] = await Promise.all([
    fetch(`${PUBLIC_API_URL}/episodes/${params.id}/cues`, { headers: { cookie } }),
    fetch(`${PUBLIC_API_URL}/shows/${episode.showId}/glossary`, { headers: { cookie } }),
  ]);
  if (!cuesRes.ok) throw error(cuesRes.status, "Failed to load cues");
  const { cues } = (await cuesRes.json()) as { cues: Cue[] };
  const glossaryTerms = glossaryRes.ok
    ? ((await glossaryRes.json()) as { glossaryTerms: GlossaryTerm[] }).glossaryTerms
    : [];

  return { episode, cues, glossaryTerms };
};
