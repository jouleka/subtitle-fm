import { expect, test } from 'bun:test';
import { matchingTermIds } from './glossary-match';
import type { GlossaryTerm } from '@subtitle-fm/shared';

function term(over: Partial<GlossaryTerm> & { id: string; sourceText: string; targetText: string }): GlossaryTerm {
  return { showId: 'show-1', kind: 'term', notes: null, ...over };
}

test('matches a term whose source text appears in the focused cue (headword present)', () => {
  const t = term({ id: 'a', sourceText: 'Sharingan', targetText: 'Mirror Wheel Eye' });
  expect(matchingTermIds('He awakened the Sharingan.', [t])).toEqual(new Set(['a']));
});

test('matches a term whose target text appears in the cue (canonical translation used)', () => {
  const t = term({ id: 'a', sourceText: 'Kage Bunshin', targetText: 'Shadow Clone' });
  expect(matchingTermIds('A dozen Shadow Clone copies.', [t])).toEqual(new Set(['a']));
});

test('matches case-insensitively so casing differences do not hide a glossary hit', () => {
  const t = term({ id: 'a', sourceText: 'Hokage', targetText: 'Fire Shadow' });
  expect(matchingTermIds('the HOKAGE arrives', [t])).toEqual(new Set(['a']));
});

test('excludes a term that appears in neither field of the cue', () => {
  const t = term({ id: 'a', sourceText: 'Rasengan', targetText: 'Spiraling Sphere' });
  expect(matchingTermIds('Nothing relevant here.', [t]).has('a')).toBe(false);
});

test('returns an empty set for empty cue text (nothing focused → no badges)', () => {
  const t = term({ id: 'a', sourceText: 'x', targetText: 'y' });
  expect(matchingTermIds('', [t])).toEqual(new Set());
});

test('returns every matching id when several terms appear in the cue', () => {
  const a = term({ id: 'a', sourceText: 'Naruto', targetText: 'Whirlpool' });
  const b = term({ id: 'b', sourceText: 'Sasuke', targetText: 'Avenger' });
  const c = term({ id: 'c', sourceText: 'Sakura', targetText: 'Cherry' });
  expect(matchingTermIds('Naruto and Sasuke spar.', [a, b, c])).toEqual(new Set(['a', 'b']));
});

test('does no normalization beyond toLowerCase — spaces in sourceText must match exactly', () => {
  const t = term({ id: 'a', sourceText: ' Ninja ', targetText: 'zzz' });
  expect(matchingTermIds('Ninjas jump.', [t]).has('a')).toBe(false);
  expect(matchingTermIds('A Ninja jumps.', [term({ id: 'b', sourceText: 'Ninja', targetText: 'zzz' })])).toEqual(new Set(['b']));
});
