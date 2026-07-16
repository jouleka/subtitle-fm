import { error, redirect } from '@sveltejs/kit';
import { PUBLIC_API_URL } from '$env/static/public';
import type { PageServerLoad } from './$types';
import type { Episode } from '$lib/types';
import type { SnapshotMeta } from '$lib/snapshot-diff-api';

export const load: PageServerLoad = async ({ params, fetch, parent, request }) => {
  const { session } = await parent();
  if (!session?.user) throw redirect(302, '/');

  const headers = { cookie: request.headers.get('cookie') ?? '' };
  const [episodeResponse, snapshotsResponse] = await Promise.all([
    fetch(`${PUBLIC_API_URL}/episodes/${params.id}`, { headers }),
    fetch(`${PUBLIC_API_URL}/episodes/${params.id}/snapshots`, { headers }),
  ]);
  if (episodeResponse.status === 404) throw error(404, 'Episode not found');
  if (!episodeResponse.ok) throw error(episodeResponse.status, 'Failed to load episode');
  if (!snapshotsResponse.ok) {
    throw error(snapshotsResponse.status, 'Failed to load snapshot history');
  }

  const episode = (await episodeResponse.json()) as Episode;
  const { snapshots } = (await snapshotsResponse.json()) as { snapshots: SnapshotMeta[] };
  return { episode, snapshots };
};
