import { error } from '@sveltejs/kit';
import { PUBLIC_API_URL } from '$env/static/public';
import { buildCatalog } from '$lib/catalog';
import type { Episode, Show } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch, url }) => {
  const [showsResponse, episodesResponse] = await Promise.all([
    fetch(`${PUBLIC_API_URL}/shows`),
    fetch(`${PUBLIC_API_URL}/episodes`),
  ]);
  if (!showsResponse.ok || !episodesResponse.ok) throw error(503, 'Catalog is temporarily unavailable');
  const { shows } = (await showsResponse.json()) as { shows: Show[] };
  const { episodes } = (await episodesResponse.json()) as { episodes: Episode[] };
  const show = buildCatalog(shows, episodes).find((entry) => entry.slug === params.slug);
  if (!show) throw error(404, 'Show not found');
  return { show, canonical: `${url.origin}/shows/${encodeURIComponent(show.slug)}` };
};
