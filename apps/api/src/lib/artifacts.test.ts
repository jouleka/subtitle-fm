import { describe, expect, test } from 'bun:test';
import { episodePeaksKey, episodePeaksUrl } from './artifacts';

describe('episode waveform artifacts', () => {
  test('uses a stable per-episode object key', () => {
    expect(episodePeaksKey('ep-1')).toBe('ep-1.dat');
  });

  test('rejects episode ids that could change the object key path', () => {
    expect(() => episodePeaksKey('../escape')).toThrow('invalid episode id');
    expect(() => episodePeaksKey('a/b')).toThrow('invalid episode id');
  });

  test('builds a stable application URL without duplicate slashes', () => {
    expect(episodePeaksUrl('https://api.example///', 'ep-1')).toBe(
      'https://api.example/episodes/ep-1/peaks.dat',
    );
  });
});
