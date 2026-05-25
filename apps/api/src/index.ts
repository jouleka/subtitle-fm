import { Hono } from 'hono';
import { logger as httpLogger } from 'hono/logger';
import { cors } from 'hono/cors';
import { health } from './routes/health';
import { episodes } from './routes/episodes';
import { shows } from './routes/shows';
import { uploads } from './routes/uploads';
import { log } from './lib/log';

const app = new Hono();

app.use('*', httpLogger((msg) => log.info(msg)));
app.use('*', cors({ origin: '*' }));

app.route('/health', health);
app.route('/shows', shows);
app.route('/episodes', episodes);
app.route('/uploads', uploads);

const port = Number(process.env.API_PORT ?? 3000);
log.info({ port }, 'api.listen');

export default {
  port,
  fetch: app.fetch,
};
