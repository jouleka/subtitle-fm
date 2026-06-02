import { expect, test } from 'bun:test';
import { parseStremioSubtitleId } from './stremio-id';

test('parses an imdb series id (captures season; episode is the last segment)', () => {
  expect(parseStremioSubtitleId('series', 'tt0903747:1:5')).toEqual({ source: 'imdb', externalId: 'tt0903747', episode: 5, season: 1 });
});
test('omits season for a non-integer imdb season segment', () => {
  expect(parseStremioSubtitleId('series', 'tt0903747:x:5')).toEqual({ source: 'imdb', externalId: 'tt0903747', episode: 5 });
});
test('parses a kitsu series id', () => {
  expect(parseStremioSubtitleId('series', 'kitsu:42:7')).toEqual({ source: 'kitsu', externalId: '42', episode: 7 });
});
test('parses a mal series id', () => {
  expect(parseStremioSubtitleId('series', 'mal:99:3')).toEqual({ source: 'mal', externalId: '99', episode: 3 });
});
test('returns null for a movie type', () => {
  expect(parseStremioSubtitleId('movie', 'tt0111161')).toBeNull();
});
test('returns null for too few segments', () => {
  expect(parseStremioSubtitleId('series', 'tt0903747:5')).toBeNull();
  expect(parseStremioSubtitleId('series', 'kitsu')).toBeNull();
});
test('returns null for a non-numeric episode', () => {
  expect(parseStremioSubtitleId('series', 'kitsu:42:abc')).toBeNull();
});
test('returns null for an unknown prefix', () => {
  expect(parseStremioSubtitleId('series', 'anidb:1:2')).toBeNull();
});
