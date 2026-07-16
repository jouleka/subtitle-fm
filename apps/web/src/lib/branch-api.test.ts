import { afterEach, describe, expect, mock, test } from 'bun:test';
import { createSubtitleBranch, fetchBranchDiff, mergeSubtitleBranch } from './branch-api';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('branch API (SFM-39)', () => {
  test('creates an authenticated branch fork', async () => {
    const fetchMock = mock(async () => Response.json({ id: 'branch-id', name: 'alternate' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await createSubtitleBranch('http://api.test', 'episode/id', {
      name: 'alternate',
      baseSnapshotId: 'base-id',
    });
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/episodes/episode%2Fid/branches', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'alternate', baseSnapshotId: 'base-id' }),
    });
  });

  test('loads the active branch comparison', async () => {
    const fetchMock = mock(async () => Response.json({ snapshots: {}, diff: {} }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await fetchBranchDiff('http://api.test', 'episode', 'branch/id');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/episodes/episode/branches/branch%2Fid/compare',
      { credentials: 'include' },
    );
  });

  test('surfaces conflicts from merge', async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ error: 'merge_conflicts' }, { status: 409 }),
    ) as unknown as typeof fetch;
    expect(mergeSubtitleBranch('http://api.test', 'episode', 'branch')).rejects.toThrow(
      'merge_conflicts',
    );
  });

  test('submits explicit reviewer decisions', async () => {
    const fetchMock = mock(async () => Response.json({ branch: {}, mergeSnapshot: {} }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await mergeSubtitleBranch('http://api.test', 'episode', 'branch', [
      { key: '1000:0', choice: 'manual', manualText: 'reviewed' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/episodes/episode/branches/branch/merge',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          resolutions: [{ key: '1000:0', choice: 'manual', manualText: 'reviewed' }],
        }),
      },
    );
  });
});
