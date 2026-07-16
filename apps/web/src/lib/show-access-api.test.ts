import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fetchShowAccess } from './show-access-api';

afterEach(() => mock.restore());

describe('show access API (SFM-32)', () => {
  test('loads current role, reputation, and capabilities with credentials', async () => {
    const fetchMock = mock(async () =>
      Response.json({
        reputation: 10,
        globalRole: 'editor',
        showRole: 'tlc',
        thresholds: { merge: 10, publish: 30 },
        canSuggest: true,
        canMerge: true,
        canPublish: false,
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const access = await fetchShowAccess('http://api.test', 'show/id');
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/shows/show%2Fid/access', {
      credentials: 'include',
    });
    expect(access).toMatchObject({ reputation: 10, showRole: 'tlc', canMerge: true });
  });
});
