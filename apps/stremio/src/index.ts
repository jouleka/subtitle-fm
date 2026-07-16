// @ts-expect-error stremio-addon-sdk ships untyped
import { addonBuilder, serveHTTP } from 'stremio-addon-sdk';
import { fetchSubtitles, manifest } from './addon';

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(fetchSubtitles);

const port = Number(process.env.STREMIO_PORT ?? process.env.PORT ?? 7000);
serveHTTP(builder.getInterface(), { port });
console.log(`stremio addon on http://localhost:${port}`);
