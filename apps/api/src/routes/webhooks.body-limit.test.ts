import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { webhooksLemonSqueezy } from './webhooks-lemonsqueezy';
import { webhooksRunpod } from './webhooks-runpod';

describe('webhook body limits', () => {
  test('rejects an oversized Lemon Squeezy request before verification', async () => {
    const app = new Hono().route('/webhooks/lemonsqueezy', webhooksLemonSqueezy);
    const response = await app.request('/webhooks/lemonsqueezy', {
      method: 'POST',
      body: 'x'.repeat(1024 * 1024 + 1),
    });
    expect(response.status).toBe(413);
  });

  test('rejects an oversized RunPod request before verification', async () => {
    const app = new Hono().route('/webhooks/runpod', webhooksRunpod);
    const response = await app.request('/webhooks/runpod', {
      method: 'POST',
      body: 'x'.repeat(10 * 1024 * 1024 + 1),
    });
    expect(response.status).toBe(413);
  });
});
