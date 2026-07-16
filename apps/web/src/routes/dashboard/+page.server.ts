import { error, fail, redirect } from '@sveltejs/kit';
import { PUBLIC_API_URL } from '$env/static/public';
import type { Actions, PageServerLoad } from './$types';

export type ApiAccessData = {
  tier: 'free' | 'dev' | 'pro';
  dailyLimit: number | null;
  keys: Array<{
    id: string;
    name: string;
    prefix: string;
    createdAt: string;
    lastUsedAt: string | null;
    todayUsage: number;
    last30DaysUsage: number;
  }>;
};

function cookie(request: Request): string {
  return request.headers.get('cookie') ?? '';
}

async function requireApiAccess(fetcher: typeof fetch, request: Request): Promise<ApiAccessData> {
  const response = await fetcher(`${PUBLIC_API_URL}/account/api-access`, {
    headers: { cookie: cookie(request) },
  });
  if (response.status === 401) throw redirect(302, '/');
  if (!response.ok) throw error(503, 'API access is temporarily unavailable');
  return response.json() as Promise<ApiAccessData>;
}

export const load: PageServerLoad = async ({ fetch, request, parent }) => {
  const { session } = await parent();
  if (!session?.user) throw redirect(302, '/');
  return { access: await requireApiAccess(fetch, request) };
};

export const actions: Actions = {
  createKey: async ({ fetch, request }) => {
    const form = await request.formData();
    const name = String(form.get('name') ?? '').trim();
    if (!name || name.length > 80) return fail(400, { message: 'Give the key a name up to 80 characters.' });
    const response = await fetch(`${PUBLIC_API_URL}/account/api-keys`, {
      method: 'POST',
      headers: { cookie: cookie(request), 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const body = (await response.json().catch(() => ({}))) as { secret?: string };
    if (response.status === 401) throw redirect(302, '/');
    if (!response.ok || !body.secret) return fail(response.status || 500, { message: 'The API key could not be created.' });
    return { created: true, secret: body.secret };
  },
  revokeKey: async ({ fetch, request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, { message: 'Invalid API key.' });
    const response = await fetch(`${PUBLIC_API_URL}/account/api-keys/${id}`, {
      method: 'DELETE',
      headers: { cookie: cookie(request) },
    });
    if (response.status === 401) throw redirect(302, '/');
    if (!response.ok) return fail(response.status || 500, { message: 'The API key could not be revoked.' });
    return { revoked: true };
  },
};
