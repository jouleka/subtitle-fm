import { fail } from '@sveltejs/kit';
import { PUBLIC_API_URL } from '$env/static/public';
import { env } from '$env/dynamic/public';
import type { Actions, PageServerLoad } from './$types';

function value(form: FormData, name: string): string {
  return String(form.get(name) ?? '').trim();
}

async function apiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (body.error === 'material_not_found') return 'That Subtitle.fm episode could not be found.';
  if (body.error === 'material_url_must_identify_episode') {
    return 'Use the full Subtitle.fm episode or subtitle URL.';
  }
  if (body.error === 'counter_notice_not_available') {
    return 'That notice is not currently eligible for a counter-notice.';
  }
  return 'The request could not be submitted. Please try again.';
}

export const load: PageServerLoad = () => ({
  agent: {
    name: env.PUBLIC_DMCA_AGENT_NAME ?? null,
    email: env.PUBLIC_DMCA_AGENT_EMAIL ?? null,
    address: env.PUBLIC_DMCA_AGENT_ADDRESS ?? null,
  },
});

export const actions: Actions = {
  notice: async ({ fetch, request }) => {
    const form = await request.formData();
    const payload = {
      claimantName: value(form, 'claimantName'),
      claimantEmail: value(form, 'claimantEmail'),
      claimantAddress: value(form, 'claimantAddress'),
      claimantPhone: value(form, 'claimantPhone'),
      copyrightedWork: value(form, 'copyrightedWork'),
      materialUrl: value(form, 'materialUrl'),
      signature: value(form, 'signature'),
      goodFaithConfirmed: form.get('goodFaithConfirmed') === 'on',
      accuracyConfirmed: form.get('accuracyConfirmed') === 'on',
    };
    const response = await fetch(`${PUBLIC_API_URL}/legal/takedowns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok)
      return fail(response.status || 400, { kind: 'notice', message: await apiError(response) });
    const body = (await response.json()) as { notice: { id: string } };
    return { kind: 'notice', submitted: true, trackingId: body.notice.id };
  },
  counter: async ({ fetch, request }) => {
    const form = await request.formData();
    const noticeId = value(form, 'noticeId');
    if (!/^[0-9a-f-]{36}$/i.test(noticeId)) {
      return fail(400, { kind: 'counter', message: 'Enter the notice tracking ID.' });
    }
    const payload = {
      submitterName: value(form, 'submitterName'),
      submitterEmail: value(form, 'submitterEmail'),
      submitterAddress: value(form, 'submitterAddress'),
      submitterPhone: value(form, 'submitterPhone'),
      removedMaterialUrl: value(form, 'removedMaterialUrl'),
      signature: value(form, 'signature'),
      mistakeConfirmed: form.get('mistakeConfirmed') === 'on',
      jurisdictionConfirmed: form.get('jurisdictionConfirmed') === 'on',
      serviceConfirmed: form.get('serviceConfirmed') === 'on',
    };
    const response = await fetch(
      `${PUBLIC_API_URL}/legal/takedowns/${encodeURIComponent(noticeId)}/counter-notice`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok)
      return fail(response.status || 400, { kind: 'counter', message: await apiError(response) });
    const body = (await response.json()) as {
      counterNotice: { id: string; restoreEligibleAt: string; restoreDeadlineAt: string };
    };
    return { kind: 'counter', submitted: true, ...body.counterNotice };
  },
};
