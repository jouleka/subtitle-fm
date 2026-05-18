import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { health } from './routes/health';
import { episodes } from './routes/episodes';

const app = new Hono();

app.use('*', logger());
app.use('*', cors({ origin: '*' }));

app.route('/health', health);
app.route('/episodes', episodes);

const port = Number(process.env.API_PORT ?? 3000);

export default {
  port,
  fetch: app.fetch,
};
