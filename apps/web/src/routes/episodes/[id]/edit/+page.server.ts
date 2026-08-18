import type { PageServerLoad } from "./$types";
import { error, redirect } from "@sveltejs/kit";
import { PUBLIC_API_URL } from "$env/static/public";
import type { Cue, Episode } from "$lib/types";
import type { GlossaryTerm } from "@subtitle-fm/shared";
import type { SubtitleBranchDetail } from "$lib/branch-api";
import type { ShowAccess } from "$lib/show-access-api";

export const load: PageServerLoad = async ({ params, fetch, parent, request, url }) => {
  const { session } = await parent();
  if (!session?.user) {
    throw redirect(302, "/");
  }

  const cookie = request.headers.get("cookie") ?? "";
  const epRes = await fetch(`${PUBLIC_API_URL}/episodes/${params.id}`, { headers: { cookie } });
  if (epRes.status === 404) throw error(404, "Episode not found");
  if (!epRes.ok) throw error(epRes.status, "Failed to load episode");
  const episode = (await epRes.json()) as Episode;

  const branchId = url.searchParams.get("branch");
  const [cuesRes, glossaryRes, branchRes, accessRes, collabTicketRes] = await Promise.all([
    fetch(`${PUBLIC_API_URL}/episodes/${params.id}/cues`, { headers: { cookie } }),
    fetch(`${PUBLIC_API_URL}/shows/${episode.showId}/glossary`, { headers: { cookie } }),
    branchId
      ? fetch(`${PUBLIC_API_URL}/episodes/${params.id}/branches/${encodeURIComponent(branchId)}`, {
          headers: { cookie },
        })
      : Promise.resolve(null),
    fetch(`${PUBLIC_API_URL}/shows/${episode.showId}/access`, { headers: { cookie } }),
    fetch(`${PUBLIC_API_URL}/account/collab-ticket`, {
      method: "POST",
      headers: { cookie },
    }),
  ]);
  if (!cuesRes.ok) throw error(cuesRes.status, "Failed to load cues");
  if (branchRes && !branchRes.ok) throw error(branchRes.status, "Branch not found");
  const { cues } = (await cuesRes.json()) as { cues: Cue[] };
  const branch = branchRes ? ((await branchRes.json()) as SubtitleBranchDetail) : null;
  const glossaryTerms = glossaryRes.ok
    ? ((await glossaryRes.json()) as { glossaryTerms: GlossaryTerm[] }).glossaryTerms
    : [];
  if (!accessRes.ok) throw error(accessRes.status, "Failed to load contributor access");
  const access = (await accessRes.json()) as ShowAccess;
  const collabTicket = collabTicketRes.ok
    ? ((await collabTicketRes.json()) as { ticket: string }).ticket
    : null;

  return { episode, cues, glossaryTerms, branch, access, collabTicket };
};
