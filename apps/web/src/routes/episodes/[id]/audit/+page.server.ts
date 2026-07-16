import { error, redirect } from '@sveltejs/kit';
import { PUBLIC_API_URL } from '$env/static/public';
import type { CueAuditEvent } from '$lib/audit-api';
import type { Episode } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch, parent, request }) => {
  const { session } = await parent();
  if (!session?.user) throw redirect(302, '/');
  const headers = { cookie: request.headers.get('cookie') ?? '' };
  const [episodeResponse, auditResponse] = await Promise.all([
    fetch(`${PUBLIC_API_URL}/episodes/${params.id}`, { headers }),
    fetch(`${PUBLIC_API_URL}/episodes/${params.id}/audit?limit=50`, { headers }),
  ]);
  if (episodeResponse.status === 404) throw error(404, 'Episode not found');
  if (!episodeResponse.ok) throw error(episodeResponse.status, 'Failed to load episode');
  if (!auditResponse.ok) throw error(auditResponse.status, 'Failed to load audit history');
  const episode = (await episodeResponse.json()) as Episode;
  const audit = (await auditResponse.json()) as {
    events: CueAuditEvent[];
    hasMore: boolean;
    nextBefore: string | null;
    nextBeforeId: string | null;
  };
  return { episode, ...audit };
};
