import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { db } from '../lib/db';
import { parseStremioSubtitleId } from '../lib/stremio-id';
import { toIso639_2 } from '../lib/iso639';

export const stremio = new Hono().get('/subtitles/:type/:id', async (c) => {
  const type = c.req.param('type');
  const parsed = parseStremioSubtitleId(type, c.req.param('id'));
  if (!parsed) return c.json({ subtitles: [] });

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
  if (!show) return c.json({ subtitles: [] });

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
  const [ep] =
    type === 'series'
      ? await query
          .innerJoin(schema.seasons, eq(schema.episodes.seasonId, schema.seasons.id))
          .where(and(...episodeIdentity))
          .limit(1)
      : await query.where(and(...episodeIdentity)).limit(1);
  if (!ep || ep.status !== 'published') return c.json({ subtitles: [] });

  const base = process.env.API_PUBLIC_URL ?? new URL(c.req.url).origin;
  return c.json({
    subtitles: [
      {
        id: `sfm-${ep.id}`,
        url: `${base}/episodes/${ep.id}/subtitle.srt`,
        lang: toIso639_2(ep.targetLanguage),
      },
    ],
  });
});
