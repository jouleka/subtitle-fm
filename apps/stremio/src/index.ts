// @ts-expect-error stremio-addon-sdk ships untyped
import { addonBuilder, serveHTTP } from 'stremio-addon-sdk';

const manifest = {
  id: 'fm.subtitle.addon',
  version: '0.0.0',
  name: 'Subtitle.fm',
  description: 'Community-polished fansubs with AI bootstrap',
  resources: ['subtitles'],
  types: ['series', 'movie'],
  catalogs: [],
  idPrefixes: ['tt', 'kitsu', 'mal'],
};

const builder = new addonBuilder(manifest);

const API_URL = process.env.API_PUBLIC_URL ?? 'http://localhost:3000';

builder.defineSubtitlesHandler(async ({ id, type }: { id: string; type: string }) => {
  try {
    const res = await fetch(
      `${API_URL}/stremio/subtitles/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
    );
    if (!res.ok) return { subtitles: [] };
    const body = (await res.json()) as { subtitles?: unknown[] };
    return { subtitles: body.subtitles ?? [] };
  } catch {
    return { subtitles: [] };
  }
});

const port = Number(process.env.STREMIO_PORT ?? 7000);
serveHTTP(builder.getInterface(), { port });
console.log(`stremio addon on http://localhost:${port}`);
