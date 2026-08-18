import { error, fail } from '@sveltejs/kit';
import { PUBLIC_API_URL } from '$env/static/public';
import { buildCatalog } from '$lib/catalog';
import { isUnsupportedMediaPageUrl } from '$lib/source-media';
import type { Episode, Show } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

type FormValues = {
  showId: string;
  seasonNumber: string;
  number: string;
  title: string;
  sourceUrl: string;
  sourceLanguage: string;
  targetLanguage: string;
};

async function readCatalog(fetcher: typeof fetch) {
  const [showsResponse, episodesResponse] = await Promise.all([
    fetcher(`${PUBLIC_API_URL}/shows`),
    fetcher(`${PUBLIC_API_URL}/episodes`),
  ]);
  if (!showsResponse.ok || !episodesResponse.ok) throw error(503, 'Catalog is temporarily unavailable');
  const { shows } = (await showsResponse.json()) as { shows: Show[] };
  const { episodes } = (await episodesResponse.json()) as { episodes: Episode[] };
  return buildCatalog(shows, episodes);
}

export const load: PageServerLoad = async ({ fetch, url }) => {
  const catalog = await readCatalog(fetch);
  const requestedShow = url.searchParams.get('show');
  return {
    catalog,
    episodeCount: catalog.reduce((count, show) => count + show.episodes.length, 0),
    selectedShowId: catalog.some((show) => show.id === requestedShow) ? requestedShow : null,
    canonical: `${url.origin}/`,
  };
};

function valuesFrom(form: FormData): FormValues {
  return {
    showId: String(form.get('showId') ?? '').trim(),
    seasonNumber: String(form.get('seasonNumber') ?? '1').trim(),
    number: String(form.get('number') ?? '').trim(),
    title: String(form.get('title') ?? '').trim(),
    sourceUrl: String(form.get('sourceUrl') ?? '').trim(),
    sourceLanguage: String(form.get('sourceLanguage') ?? 'ja').trim().toLowerCase(),
    targetLanguage: String(form.get('targetLanguage') ?? 'en').trim().toLowerCase(),
  };
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export const actions: Actions = {
  submitEpisode: async ({ request, fetch }) => {
    const values = valuesFrom(await request.formData());

    const seasonNumber = Number(values.seasonNumber);
    const number = Number(values.number);
    if (
      !values.showId ||
      !Number.isInteger(seasonNumber) ||
      seasonNumber < 0 ||
      !Number.isInteger(number) ||
      number < 0 ||
      !validHttpUrl(values.sourceUrl) ||
      !/^[a-z]{2,3}$/.test(values.sourceLanguage) ||
      !/^[a-z]{2,3}$/.test(values.targetLanguage)
    ) {
      return fail(400, { values, message: 'Check the show, episode numbers, media URL, and language codes.' });
    }
    if (isUnsupportedMediaPageUrl(values.sourceUrl)) {
      return fail(400, {
        values,
        message: 'YouTube and Vimeo page links are not media files. Upload the source file instead.',
      });
    }

    const response = await fetch(`${PUBLIC_API_URL}/episodes`, {
      method: 'POST',
      headers: {
        cookie: request.headers.get('cookie') ?? '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        showId: values.showId,
        seasonNumber,
        number,
        title: values.title || undefined,
        sourceUrl: values.sourceUrl,
        sourceLanguage: values.sourceLanguage,
        targetLanguage: values.targetLanguage,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
    if (response.status === 401) {
      return fail(401, { values, message: 'Sign in with Discord to submit an episode.' });
    }
    if (response.status === 409) {
      return fail(409, {
        values,
        message: `Season ${seasonNumber}, Episode ${number} already exists for this show.`,
        existingEpisodeId: body.id,
      });
    }
    if (!response.ok || !body.id) {
      return fail(response.status || 500, { values, message: 'The episode could not be submitted. Please try again.' });
    }
    return { success: true, values: { ...values, number: '', title: '', sourceUrl: '' }, episodeId: body.id };
  },
};
