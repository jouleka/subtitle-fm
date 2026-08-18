import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { uploads } from './uploads';

describe('upload presigning authentication', () => {
  test('keeps upload metadata public', async () => {
    const app = new Hono().route('/uploads', uploads);
    const response = await app.request('/uploads/source/allowed');
    expect(response.status).toBe(200);
  });

  test('rejects anonymous presign requests before storage access', async () => {
    const app = new Hono().route('/uploads', uploads);
    const response = await app.request('/uploads/source', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'video/mp4', sizeBytes: 1024 }),
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
  });
});
