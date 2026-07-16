import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fetchSnapshotDiff } from './snapshot-diff-api';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('fetchSnapshotDiff', () => {
  test('requests the authenticated three-way comparison with all selected ids', async () => {
    const fetchMock = mock(async () =>
      Response.json({
        snapshots: {},
        diff: {
          rows: [],
          summary: { added: 0, removed: 0, modified: 0, unchanged: 0, conflicts: 0 },
        },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await fetchSnapshotDiff('http://api.test', 'episode/id', {
      base: 'base-id',
      ours: 'ours-id',
      theirs: 'theirs-id',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/episodes/episode%2Fid/snapshots/compare?base=base-id&ours=ours-id&theirs=theirs-id',
      { credentials: 'include' },
    );
  });

  test('surfaces the API error code', async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ error: 'snapshot_not_found' }, { status: 404 }),
    ) as unknown as typeof fetch;
    expect(
      fetchSnapshotDiff('http://api.test', 'episode', {
        base: 'a',
        ours: 'b',
        theirs: 'c',
      }),
    ).rejects.toThrow('snapshot_not_found');
  });
});
