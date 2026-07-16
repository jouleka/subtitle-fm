import { error, redirect } from '@sveltejs/kit';
import { PUBLIC_API_URL } from '$env/static/public';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, parent, request }) => {
  const { session } = await parent();
  if (!session?.user) throw redirect(302, '/');
  const response = await fetch(`${PUBLIC_API_URL}/account/first-contribution`, {
    headers: { cookie: request.headers.get('cookie') ?? '' },
  });
  if (!response.ok) throw error(503, 'Contributor onboarding is temporarily unavailable');
  const { episodeId } = (await response.json()) as { episodeId: string | null };
  if (episodeId) throw redirect(302, `/episodes/${episodeId}/edit`);
  return {};
};
