import { describe, expect, test } from 'bun:test';
import { parseExternalIdMappings, planExternalIdBackfill } from './external-id-backfill';

describe('external-id backfill planning (SFM-65)', () => {
  test('parses an explicit mapping and rejects duplicate identifiers', () => {
    expect(parseExternalIdMappings('[{"showId":"show-a","imdbId":"tt123","malId":"42"}]')).toEqual([
      { showId: 'show-a', imdbId: 'tt123', malId: '42' },
    ]);
    expect(() =>
      parseExternalIdMappings(
        '[{"showId":"show-a","imdbId":"tt123"},{"showId":"show-b","imdbId":"tt123"}]',
      ),
    ).toThrow('duplicate imdbId');
    expect(() => parseExternalIdMappings('[{"showId":"show-a","imdbId":"not-imdb"}]')).toThrow();
    expect(() =>
      parseExternalIdMappings('[{"showId":"show-a","malId":"42","imbdId":"tt123"}]'),
    ).toThrow();
  });

  test('plans null-only updates and refuses overwrite or cross-show ownership conflicts', () => {
    const existing = [
      { showId: 'show-a', imdbId: null, malId: '42', kitsuId: null, anilistId: null },
      { showId: 'show-b', imdbId: 'tt999', malId: null, kitsuId: null, anilistId: null },
    ];
    const plan = planExternalIdBackfill(
      [
        { showId: 'show-a', imdbId: 'tt123', malId: '43' },
        { showId: 'show-b', malId: '42' },
        { showId: 'missing', kitsuId: 'kitsu-1' },
      ],
      existing,
    );
    expect(plan).toEqual([
      { showId: 'show-a', changes: { imdbId: 'tt123' }, errors: ['malId_conflict:42'] },
      { showId: 'show-b', changes: {}, errors: ['malId_owned_by:show-a'] },
      { showId: 'missing', changes: {}, errors: ['show_not_found'] },
    ]);
  });
});
