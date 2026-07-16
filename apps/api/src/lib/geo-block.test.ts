import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { jpGeoBlock, requestCountry } from './geo-block';

const app = new Hono();
app.use('*', jpGeoBlock);
app.get('/content', (c) => c.json({ ok: true }));
app.get('/health', (c) => c.json({ ok: true }));
app.post('/legal/takedowns', (c) => c.json({ accepted: true }, 202));

describe('JP geo-block (SFM-46)', () => {
  test('returns 451 for a Cloudflare-confirmed JP content request', async () => {
    const response = await app.request('/content', { headers: { 'cf-ipcountry': 'jp' } });
    expect(response.status).toBe(451);
    expect(await response.json()).toEqual({
      error: 'geo_blocked',
      country: 'JP',
      legal: '/legal/takedowns',
    });
  });

  test('keeps health, legal requests, and CORS preflight reachable from JP', async () => {
    expect((await app.request('/health', { headers: { 'cf-ipcountry': 'JP' } })).status).toBe(200);
    expect(
      (
        await app.request('/legal/takedowns', {
          method: 'POST',
          headers: { 'cf-ipcountry': 'JP' },
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await app.request('/content', {
          method: 'OPTIONS',
          headers: { 'cf-ipcountry': 'JP' },
        })
      ).status,
    ).not.toBe(451);
  });

  test('does not trust arbitrary country values or block other countries', async () => {
    expect(
      requestCountry(new Request('https://example.test', { headers: { 'cf-ipcountry': 'Japan' } })),
    ).toBeNull();
    expect((await app.request('/content', { headers: { 'cf-ipcountry': 'US' } })).status).toBe(200);
    expect((await app.request('/content')).status).toBe(200);
  });
});
