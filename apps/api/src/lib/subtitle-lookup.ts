import { and, eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { db } from './db';
import { toIso639_2 } from './iso639';
import { parseStremioSubtitleId } from './stremio-id';

export async function lookupPublishedSubtitles(type: string, id: string, requestUrl: string) {
  const parsed = parseStremioSubtitleId(type, id);
  if (!parsed) return { subtitles: [] };

  const col =
    parsed.source === 'imdb'
      ? schema.shows.imdbId
      : parsed.source === 'kitsu'
        ? schema.shows.kitsuId
        : schema.shows.malId;
  const [show] = await db
    .select({ id: schema.shows.id })
    .from(schema.shows)
    .where(eq(col, parsed.externalId))
    .limit(1);
  if (!show) return { subtitles: [] };

  const episodeIdentity = [
    eq(schema.episodes.showId, show.id),
    eq(schema.episodes.number, parsed.episode),
  ];
  if (type === 'series') {
    episodeIdentity.push(eq(schema.seasons.number, parsed.season ?? 1));
  }

  const query = db
    .select({
      id: schema.episodes.id,
      status: schema.episodes.status,
      targetLanguage: schema.episodes.targetLanguage,
    })
    .from(schema.episodes);
  const [episode] =
    type === 'series'
      ? await query
          .innerJoin(schema.seasons, eq(schema.episodes.seasonId, schema.seasons.id))
          .where(and(...episodeIdentity))
          .limit(1)
      : await query.where(and(...episodeIdentity)).limit(1);
  if (!episode || episode.status !== 'published') return { subtitles: [] };

  const base = process.env.API_PUBLIC_URL ?? new URL(requestUrl).origin;
  return {
    subtitles: [
      {
        id: `sfm-${episode.id}`,
        url: `${base}/episodes/${episode.id}/subtitle.srt`,
        lang: toIso639_2(episode.targetLanguage),
      },
    ],
  };
}
