import { describe, expect, test } from 'bun:test';
import { fetchSubtitles, manifest } from './addon';

describe('Stremio addon publication contract (SFM-31)', () => {
  test('exposes a publishable manifest', () => {
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.resources).toContain('subtitles');
    expect(manifest.types).toEqual(['series', 'movie']);
    expect(manifest.idPrefixes).toEqual(['tt', 'kitsu', 'mal']);
  });

  test('proxies encoded Stremio ids to the public API', async () => {
    let requested = '';
    const result = await fetchSubtitles(
      { type: 'series', id: 'kitsu:42:3' },
      'https://api.subtitle.fm/',
      async (input) => {
        requested = String(input);
        return Response.json({
          subtitles: [
            { id: 'sfm-episode', url: 'https://api.subtitle.fm/subtitle.srt', lang: 'eng' },
          ],
        });
      },
    );

    expect(requested).toBe('https://api.subtitle.fm/stremio/subtitles/series/kitsu%3A42%3A3');
    expect(result.subtitles).toHaveLength(1);
  });

  test('fails closed when the API is unavailable or malformed', async () => {
    expect(
      await fetchSubtitles(
        { type: 'series', id: 'tt1:1:1' },
        'https://api.subtitle.fm',
        async () => {
          throw new Error('offline');
        },
      ),
    ).toEqual({ subtitles: [] });
    expect(
      await fetchSubtitles({ type: 'series', id: 'tt1:1:1' }, 'https://api.subtitle.fm', async () =>
        Response.json({ subtitles: 'invalid' }),
      ),
    ).toEqual({ subtitles: [] });
  });
});
