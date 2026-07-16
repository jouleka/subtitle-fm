import { Hono } from 'hono';
import { lookupPublishedSubtitles } from '../lib/subtitle-lookup';

export const stremio = new Hono().get('/subtitles/:type/:id', async (c) => {
  return c.json(await lookupPublishedSubtitles(c.req.param('type'), c.req.param('id'), c.req.url));
});
