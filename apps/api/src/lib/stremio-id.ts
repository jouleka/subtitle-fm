export type StremioSubSource = 'imdb' | 'kitsu' | 'mal';

export interface ParsedStremioSubId {
  source: StremioSubSource;
  externalId: string;
  episode: number;
  /** imdb season segment, if present and valid. */
  season?: number;
}

/**
 * Parse a Stremio subtitles request into our lookup keys, or null if unsupported.
 * Series ids: imdb `tt<digits>:<season>:<episode>`, `kitsu:<id>:<episode>`,
 * `mal:<id>:<episode>`. Kitsu/MAL omit a season and resolve to season 1.
 * Movies and malformed ids return null (caller serves []).
 */
export function parseStremioSubtitleId(type: string, id: string): ParsedStremioSubId | null {
  if (type === 'movie') {
    // Movies map to a show's single episode (numbered 1). imdb movie ids are a
    // bare `tt<digits>`; kitsu/mal movie ids are `<prefix>:<id>` (no episode).
    const parts = id.split(':');
    if (parts.length === 1 && parts[0]!.startsWith('tt')) {
      return { source: 'imdb', externalId: parts[0]!, episode: 1 };
    }
    if (parts.length === 2 && (parts[0] === 'kitsu' || parts[0] === 'mal') && parts[1]) {
      return { source: parts[0], externalId: parts[1], episode: 1 };
    }
    return null;
  }
  if (type !== 'series') return null;
  const parts = id.split(':');
  if (parts.length < 3) return null;
  const episode = Number(parts[parts.length - 1]);
  if (!Number.isInteger(episode) || episode < 0) return null;
  const prefix = parts[0]!;
  if (prefix.startsWith('tt')) {
    // imdb ids are `tt<digits>:<season>:<episode>`.
    const season = Number(parts[1]);
    const base = { source: 'imdb' as const, externalId: prefix, episode };
    return Number.isInteger(season) && season >= 0 ? { ...base, season } : base;
  }
  if (prefix === 'kitsu' || prefix === 'mal') {
    const externalId = parts[1];
    if (!externalId) return null;
    return { source: prefix, externalId, episode };
  }
  return null;
}
