import { afterEach, describe, expect, mock, test } from 'bun:test';
import { auditValue, fetchCueAudit, fetchEpisodeAudit } from './audit-api';

afterEach(() => mock.restore());

describe('audit API (SFM-33)', () => {
  test('loads the last five attributed cue changes', async () => {
    const fetchMock = mock(async () => Response.json({ events: [{ id: 'event' }] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const events = await fetchCueAudit('http://api.test', 'episode/id', 'cue/id');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/episodes/episode%2Fid/audit/cues/cue%2Fid?limit=5',
      { credentials: 'include' },
    );
    expect(events).toHaveLength(1);
  });

  test('requests an older timeline page with an encoded cursor', async () => {
    const fetchMock = mock(async () =>
      Response.json({ events: [], hasMore: false, nextBefore: null, nextBeforeId: null }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await fetchEpisodeAudit('http://api.test', 'episode', {
      limit: 20,
      before: '2026-07-16T10:00:00.000Z',
      beforeId: '33333333-3333-4333-8333-333333333333',
    });
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/episodes/episode/audit?');
    expect(url).toContain('limit=20');
    expect(url).toContain('before=2026-07-16T10%3A00%3A00.000Z');
    expect(url).toContain('beforeId=33333333-3333-4333-8333-333333333333');
  });

  test('renders null, strings, and structured values compactly', () => {
    expect(auditValue(null)).toBe('∅');
    expect(auditValue('')).toBe('empty');
    expect(auditValue({ text: 'cue' })).toBe('{"text":"cue"}');
  });
});
