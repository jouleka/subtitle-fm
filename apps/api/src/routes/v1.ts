import { Hono } from 'hono';
import { apiRateLimit, type ApiAccessVariables } from '../lib/api-access';
import { lookupPublishedSubtitles } from '../lib/subtitle-lookup';

export const v1 = new Hono<{ Variables: ApiAccessVariables }>()
  .use('*', apiRateLimit)
  .get('/subtitles/:type/:id', async (c) => {
    const type = c.req.param('type');
    if (type !== 'series' && type !== 'movie') {
      return c.json({ error: 'unsupported_type' }, 400);
    }
    return c.json(await lookupPublishedSubtitles(type, c.req.param('id'), c.req.url));
  });
