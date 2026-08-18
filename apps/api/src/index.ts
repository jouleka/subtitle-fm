import { Hono } from 'hono';
import { logger as httpLogger } from 'hono/logger';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { health } from './routes/health';
import { episodes } from './routes/episodes';
import { shows } from './routes/shows';
import { uploads } from './routes/uploads';
import { webhooksRunpod } from './routes/webhooks-runpod';
import { webhooksLemonSqueezy } from './routes/webhooks-lemonsqueezy';
import { glossary } from './routes/glossary';
import { stremio } from './routes/stremio';
import { snapshots } from './routes/snapshots';
import { branches } from './routes/branches';
import { audit } from './routes/audit';
import { account } from './routes/account';
import { v1 } from './routes/v1';
import { legal } from './routes/legal';
import { auth } from './lib/auth';
import { jpGeoBlock } from './lib/geo-block';
import { attachSession, type AuthVariables } from './lib/session';
import { log } from './lib/log';

const WEB_ORIGIN = process.env.WEB_URL ?? 'http://localhost:5173';

export const app = new Hono<{ Variables: AuthVariables }>();

app.use(
  '*',
  secureHeaders({
    crossOriginResourcePolicy: 'cross-origin',
    permissionsPolicy: {
      camera: false,
      geolocation: false,
      microphone: false,
    },
  }),
);

app.use(
  '*',
  httpLogger((msg) => log.info(msg)),
);

app.use(
  '*',
  cors({
    origin: WEB_ORIGIN,
    allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    exposeHeaders: [
      'X-RateLimit-Policy',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'Retry-After',
    ],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);

app.use('*', jpGeoBlock);

// Auth handler is mounted BEFORE attachSession on purpose: Better Auth handles
// /api/auth/* requests itself and returns a Response (no next()), so attachSession
// is skipped for those paths. Keep this ordering when adding new global middleware.
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.use('*', attachSession);

app.route('/health', health);
app.route('/shows', shows);
app.route('/shows/:showId/glossary', glossary);
app.route('/episodes', episodes);
app.route('/episodes/:episodeId/snapshots', snapshots);
app.route('/episodes/:episodeId/branches', branches);
app.route('/episodes/:episodeId/audit', audit);
app.route('/uploads', uploads);
app.route('/webhooks/runpod', webhooksRunpod);
app.route('/webhooks/lemonsqueezy', webhooksLemonSqueezy);
app.route('/stremio', stremio);
app.route('/account', account);
app.route('/v1', v1);
app.route('/legal', legal);

// Container hosts such as Render inject PORT. Keep API_PORT as the explicit
// service override used by local development and existing deployments.
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3000);
log.info({ port }, 'api.listen');

export default {
  port,
  fetch: app.fetch,
};
