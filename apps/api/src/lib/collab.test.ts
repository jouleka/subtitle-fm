import { describe, expect, test } from 'bun:test';
import { resolveCollabBase } from './collab';

describe('resolveCollabBase', () => {
  test('prefers an explicit internal URL', () => {
    expect(
      resolveCollabBase({
        COLLAB_INTERNAL_URL: 'https://collab.example.test',
        COLLAB_INTERNAL_HOSTPORT: 'collab:10000',
        COLLAB_PORT: '1234',
      }),
    ).toBe('https://collab.example.test');
  });

  test('builds an HTTP URL from a container hostport', () => {
    expect(resolveCollabBase({ COLLAB_INTERNAL_HOSTPORT: 'subtitle-fm-collab:10000' })).toBe(
      'http://subtitle-fm-collab:10000',
    );
  });

  test('falls back to the local collab port', () => {
    expect(resolveCollabBase({ COLLAB_PORT: '4321' })).toBe('http://localhost:4321');
    expect(resolveCollabBase({})).toBe('http://localhost:1234');
  });
});
