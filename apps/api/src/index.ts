import { Hono } from 'hono';
import { logger as httpLogger } from 'hono/logger';
import { cors } from 'hono/cors';
import { health } from './routes/health';
import { episodes } from './routes/episodes';
import { shows } from './routes/shows';
import { uploads } from './routes/uploads';
import { webhooksRunpod } from './routes/webhooks-runpod';
import { glossary } from './routes/glossary';
import { auth } from './lib/auth';
import { attachSession, type AuthVariables } from './lib/session';
import { log } from './lib/log';

const WEB_ORIGIN = process.env.WEB_URL ?? 'http://localhost:5173';

export const app = new Hono<{ Variables: AuthVariables }>();

app.use('*', httpLogger((msg) => log.info(msg)));

app.use(
  '*',
  cors({
    origin: WEB_ORIGIN,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  }),
);

// Auth handler is mounted BEFORE attachSession on purpose: Better Auth handles
// /api/auth/* requests itself and returns a Response (no next()), so attachSession
// is skipped for those paths. Keep this ordering when adding new global middleware.
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.use('*', attachSession);

app.route('/health', health);
app.route('/shows', shows);
app.route('/shows/:showId/glossary', glossary);
app.route('/episodes', episodes);
app.route('/uploads', uploads);
app.route('/webhooks/runpod', webhooksRunpod);

const port = Number(process.env.API_PORT ?? 3000);
log.info({ port }, 'api.listen');

export default {
  port,
  fetch: app.fetch,
};
