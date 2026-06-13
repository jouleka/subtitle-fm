import { z } from 'zod';
import { catalogShowSchema, type CatalogShow } from './catalog-schema';

/**
 * Resolve a show + episode list from an external metadata source (MAL via the
 * Jikan API) into a CatalogShow that importCatalog can ingest. Metadata (titles,
 * numbers, count) is fetched automatically; the actual media URLs come from a
 * caller-supplied template — there is no clean API that maps a MAL id to episode
 * media, and in practice the catalog owner supplies where their media lives.
 *
 * No DB/queue imports: this module is HTTP + pure transforms only, so the
 * resolve CLI can run (and print a manifest) without opening Redis/Postgres.
 */

const JIKAN_BASE = 'https://api.jikan.moe/v4';

export type FetchJson = (url: string) => Promise<unknown>;

export const defaultFetchJson: FetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json();
};

/**
 * Expand a media-URL template for one episode. Supported placeholders:
 *   {number}      -> raw episode number (1, 2, 10)
 *   {number:0N}   -> zero-padded to width N ({number:02} -> 01)
 *   {slug}        -> show slug
 *   {malId}       -> MAL id
 * The template MUST contain {number} (or {number:0N}); otherwise every episode
 * would resolve to the same URL and collide on (show_id, number).
 */
export function applyMediaTemplate(
  template: string,
  vars: { number: number; slug: string; malId: string | number },
): string {
  if (!/\{number(:0\d+)?\}/.test(template)) {
    throw new Error(
      `media template must contain {number} (or {number:0N}) so each episode gets a distinct URL: ${template}`,
    );
  }
  return template
    .replace(/\{number:0(\d+)\}/g, (_, width: string) =>
      String(vars.number).padStart(Number(width), '0'),
    )
    .replace(/\{number\}/g, String(vars.number))
    .replace(/\{slug\}/g, vars.slug)
    .replace(/\{malId\}/g, String(vars.malId));
}

/** Lowercase, hyphenate, strip non-[a-z0-9]. Returns "" for non-latin input. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Minimal schemas for the Jikan v4 fields we use — fail loud if the shape drifts.
const jikanAnimeSchema = z.object({
  data: z.object({
    title: z.string(),
    title_english: z.string().nullish(),
    episodes: z.number().nullish(),
  }),
});
const jikanEpisodesSchema = z.object({
  data: z.array(z.object({ mal_id: z.number(), title: z.string().nullish() })),
  pagination: z.object({ has_next_page: z.boolean() }).nullish(),
});

async function fetchAnimeMeta(
  malId: number | string,
  fetchJson: FetchJson,
): Promise<{ title: string; titleEnglish?: string | null; episodesCount?: number | null }> {
  const parsed = jikanAnimeSchema.parse(await fetchJson(`${JIKAN_BASE}/anime/${malId}`));
  return {
    title: parsed.data.title,
    titleEnglish: parsed.data.title_english,
    episodesCount: parsed.data.episodes,
  };
}

async function fetchAnimeEpisodes(
  malId: number | string,
  fetchJson: FetchJson,
): Promise<Array<{ number: number; title?: string }>> {
  const out: Array<{ number: number; title?: string }> = [];
  // Jikan paginates the episode list (100/page). Sequential awaited requests
  // provide natural spacing; most shows are a single page.
  let page = 1;
  for (;;) {
    const parsed = jikanEpisodesSchema.parse(
      await fetchJson(`${JIKAN_BASE}/anime/${malId}/episodes?page=${page}`),
    );
    for (const e of parsed.data) out.push({ number: e.mal_id, title: e.title ?? undefined });
    if (!parsed.pagination?.has_next_page) break;
    page += 1;
  }
  return out;
}

export interface ResolveDeps {
  fetchJson: FetchJson;
  /** Override the derived show id (default: `mal-<malId>`). */
  id?: string;
  /** Override the derived slug (default: slugify(title) or `mal-<malId>`). */
  slug?: string;
}

/**
 * Resolve a MAL id into a CatalogShow: fetch metadata + the episode list from
 * Jikan, then map each episode to a media URL via `mediaTemplate`. Falls back to
 * a numbered 1..N list when Jikan has a count but no per-episode detail.
 */
export async function resolveShowFromMal(
  malId: number | string,
  mediaTemplate: string,
  deps: ResolveDeps,
): Promise<CatalogShow> {
  const meta = await fetchAnimeMeta(malId, deps.fetchJson);
  const title = meta.titleEnglish || meta.title;
  const slug = deps.slug ?? (slugify(title) || `mal-${malId}`);
  const id = deps.id ?? `mal-${malId}`;

  let episodes = await fetchAnimeEpisodes(malId, deps.fetchJson);
  if (episodes.length === 0 && meta.episodesCount && meta.episodesCount > 0) {
    episodes = Array.from({ length: meta.episodesCount }, (_, i) => ({ number: i + 1 }));
  }
  if (episodes.length === 0) {
    throw new Error(
      `mal ${malId}: Jikan returned no episode list or count — write a manifest manually instead`,
    );
  }

  const show = {
    id,
    title,
    slug,
    malId: String(malId),
    episodes: episodes.map((e) => ({
      number: e.number,
      title: e.title,
      sourceUrl: applyMediaTemplate(mediaTemplate, { number: e.number, slug, malId }),
      sourceLanguage: 'ja',
      targetLanguage: 'en',
    })),
  };

  // Validate the produced show against the catalog schema so an invalid override
  // (--slug/--id) or a non-URL media template fails HERE, with an actionable
  // message — not silently downstream at import or the DB (fail loud).
  const parsed = catalogShowSchema.safeParse(show);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(
      `resolved show for mal ${malId} is invalid (check --slug/--id/--media-template): ${detail}`,
    );
  }
  return parsed.data;
}
