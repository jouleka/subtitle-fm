import { describe, expect, test } from 'bun:test';
import { buildCatalog, episodeName, statusLabel } from './catalog';
import type { Episode, Show } from './types';

const show = (id: string, title: string): Show => ({
  id,
  title,
  slug: id,
  description: null,
  imdbId: null,
  malId: null,
  anilistId: null,
  kitsuId: null,
  coverUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const episode = (showId: string, number: number, title: string | null = null): Episode => ({
  id: `${number}`.padStart(8, '0') + '-0000-4000-8000-000000000000',
  showId,
  seasonId: null,
  number,
  title,
  sourceLanguage: 'ja',
  targetLanguage: 'en',
  status: 'ready_for_edit',
  sourceKey: null,
  audioUrl: null,
  peaksUrl: null,
  durationMs: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('public catalog helpers', () => {
  test('groups episodes by show and returns stable title/episode ordering', () => {
    const catalog = buildCatalog(
      [show('zeta', 'Zeta'), show('alpha', 'Alpha')],
      [episode('alpha', 12), episode('zeta', 2), episode('alpha', 1)],
    );
    expect(catalog.map((entry) => entry.title)).toEqual(['Alpha', 'Zeta']);
    expect(catalog[0]!.episodes.map((entry) => entry.number)).toEqual([1, 12]);
  });

  test('keeps shows with no episodes so the empty state remains visible', () => {
    expect(buildCatalog([show('empty', 'Empty')], [])[0]!.episodes).toEqual([]);
  });

  test('formats episode fallbacks and public status labels', () => {
    expect(episodeName(episode('alpha', 3))).toBe('Episode 3');
    expect(episodeName(episode('alpha', 3, '  Finale  '))).toBe('Finale');
    expect(statusLabel('ready_for_edit')).toBe('Ready to edit');
    expect(statusLabel('published')).toBe('Published');
  });
});
