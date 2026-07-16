export const manifest = {
  id: 'fm.subtitle.addon',
  version: '1.0.0',
  name: 'Subtitle.fm',
  description: 'Community-polished subtitles with AI-assisted timing and translation',
  resources: ['subtitles'],
  types: ['series', 'movie'],
  catalogs: [],
  idPrefixes: ['tt', 'kitsu', 'mal'],
};

type SubtitleRequest = { id: string; type: string };
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function fetchSubtitles(
  { id, type }: SubtitleRequest,
  apiUrl = process.env.API_PUBLIC_URL ?? 'http://localhost:3000',
  fetcher: Fetcher = fetch,
): Promise<{ subtitles: unknown[] }> {
  try {
    const response = await fetcher(
      `${apiUrl.replace(/\/$/, '')}/stremio/subtitles/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
    );
    if (!response.ok) return { subtitles: [] };
    const body = (await response.json()) as { subtitles?: unknown };
    return { subtitles: Array.isArray(body.subtitles) ? body.subtitles : [] };
  } catch {
    return { subtitles: [] };
  }
}
