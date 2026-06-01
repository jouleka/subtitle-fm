export type StremioSubSource = 'imdb' | 'kitsu' | 'mal';

export interface ParsedStremioSubId {
  source: StremioSubSource;
  externalId: string;
  episode: number;
}

/**
 * Parse a Stremio subtitles request into our lookup keys, or null if unsupported.
 * Series ids: imdb `tt<digits>:<season>:<episode>` (season ignored — episodes have no
 * season, only `number`), `kitsu:<id>:<episode>`, `mal:<id>:<episode>`. Movies and
 * malformed ids return null (caller serves []).
 */
export function parseStremioSubtitleId(type: string, id: string): ParsedStremioSubId | null {
  if (type !== 'series') return null;
  const parts = id.split(':');
  if (parts.length < 3) return null;
  const episode = Number(parts[parts.length - 1]);
  if (!Number.isInteger(episode) || episode < 0) return null;
  if (parts[0].startsWith('tt')) return { source: 'imdb', externalId: parts[0], episode };
  if (parts[0] === 'kitsu' || parts[0] === 'mal') {
    if (!parts[1]) return null;
    return { source: parts[0], externalId: parts[1], episode };
  }
  return null;
}
