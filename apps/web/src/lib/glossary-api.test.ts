import { afterEach, expect, test } from 'bun:test';
import { fetchGlossary, createTerm, updateTerm, deleteTerm, GlossaryApiError } from './glossary-api';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Call = { url: string; init: RequestInit };
function stubFetch(res: { ok: boolean; status?: number; json?: unknown }): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: res.ok,
      status: res.status ?? (res.ok ? 200 : 400),
      json: () => Promise.resolve(res.json ?? {}),
    } as Response);
  }) as typeof fetch;
  return calls;
}

test('fetchGlossary GETs the show glossary with credentials and unwraps the list', async () => {
  const calls = stubFetch({ ok: true, json: { glossaryTerms: [{ id: 't1' }] } });
  const terms = await fetchGlossary('http://api.test', 'show-1');
  expect(terms).toEqual([{ id: 't1' }] as never);
  expect(calls[0].url).toBe('http://api.test/shows/show-1/glossary');
  expect(calls[0].init.credentials).toBe('include');
});

test('createTerm POSTs JSON with credentials so the cookie + body reach the gated route', async () => {
  const calls = stubFetch({ ok: true, status: 201, json: { id: 't1' } });
  await createTerm('http://api.test', 'show-1', { sourceText: 'a', targetText: 'b', kind: 'term', notes: null });
  const { url, init } = calls[0];
  expect(url).toBe('http://api.test/shows/show-1/glossary');
  expect(init.method).toBe('POST');
  expect(init.credentials).toBe('include');
  expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  expect(JSON.parse(init.body as string)).toEqual({ sourceText: 'a', targetText: 'b', kind: 'term', notes: null });
});

test('updateTerm PATCHes the per-term URL', async () => {
  const calls = stubFetch({ ok: true, json: { id: 't1' } });
  await updateTerm('http://api.test', 'show-1', 't1', { targetText: 'b2', kind: 'term', notes: null });
  expect(calls[0].url).toBe('http://api.test/shows/show-1/glossary/t1');
  expect(calls[0].init.method).toBe('PATCH');
  expect(calls[0].init.credentials).toBe('include');
  expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
});

test('deleteTerm DELETEs the per-term URL', async () => {
  const calls = stubFetch({ ok: true, json: { ok: true } });
  await deleteTerm('http://api.test', 'show-1', 't1');
  expect(calls[0].url).toBe('http://api.test/shows/show-1/glossary/t1');
  expect(calls[0].init.method).toBe('DELETE');
  expect(calls[0].init.credentials).toBe('include');
});

test('a non-OK response throws GlossaryApiError carrying the API error code (so the modal can show duplicate_source)', async () => {
  stubFetch({ ok: false, status: 409, json: { error: 'duplicate_source' } });
  let err: unknown;
  try {
    await createTerm('http://api.test', 'show-1', { sourceText: 'a', targetText: 'b', kind: 'term', notes: null });
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(GlossaryApiError);
  expect((err as GlossaryApiError).status).toBe(409);
  expect((err as GlossaryApiError).code).toBe('duplicate_source');
});

test('a non-OK response with an unparseable body falls back to request_failed', async () => {
  globalThis.fetch = (() =>
    Promise.resolve({ ok: false, status: 500, json: () => Promise.reject(new Error('no json')) } as unknown as Response)) as typeof fetch;
  let err: unknown;
  try {
    await deleteTerm('http://api.test', 'show-1', 't1');
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(GlossaryApiError);
  expect((err as GlossaryApiError).status).toBe(500);
  expect((err as GlossaryApiError).code).toBe('request_failed');
});
