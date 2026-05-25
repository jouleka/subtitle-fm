import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  buildEventId,
  dispatchToRunpod,
  getWebhookUrl,
  isRunpodMode,
  type FetchLike,
  type RunpodInput,
} from './runpod';

const BASE_INPUT: RunpodInput = {
  episodeId: 'ep-uuid',
  stage: 'preprocess',
  eventId: 'ep-uuid:preprocess:run-1',
  pipelineRunId: 'run-1',
  webhookUrl: 'https://api.example.com/webhooks/runpod',
  sourceUrl: 'https://r2.example.com/source.mp4',
};

interface FetchCall {
  url: string;
  init: RequestInit;
}

function makeMockFetcher(response: Response): { fetcher: FetchLike; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetcher: FetchLike = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response.clone();
  };
  return { fetcher, calls };
}

describe('dispatchToRunpod', () => {
  test('POSTs to the correct endpoint URL', async () => {
    const { fetcher, calls } = makeMockFetcher(
      new Response(JSON.stringify({ id: 'run-1', status: 'IN_QUEUE' }), { status: 200 }),
    );
    await dispatchToRunpod(BASE_INPUT, { apiKey: 'k', endpointId: 'epx', fetcher });
    expect(calls[0]!.url).toBe('https://api.runpod.ai/v2/epx/run');
  });

  test('sends Authorization: Bearer <apiKey> header', async () => {
    const { fetcher, calls } = makeMockFetcher(
      new Response(JSON.stringify({ id: 'run-1' }), { status: 200 }),
    );
    await dispatchToRunpod(BASE_INPUT, { apiKey: 'my-secret-key', endpointId: 'e', fetcher });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer my-secret-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('wraps input under { input } per RunPod request format', async () => {
    const { fetcher, calls } = makeMockFetcher(
      new Response(JSON.stringify({ id: 'run-1' }), { status: 200 }),
    );
    await dispatchToRunpod(BASE_INPUT, { apiKey: 'k', endpointId: 'e', fetcher });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toHaveProperty('input');
    expect(body.input).toEqual(BASE_INPUT);
  });

  test('never includes the webhook secret in the input (security: secret stays env-side)', async () => {
    const { fetcher, calls } = makeMockFetcher(
      new Response(JSON.stringify({ id: 'run-1' }), { status: 200 }),
    );
    await dispatchToRunpod(BASE_INPUT, { apiKey: 'k', endpointId: 'e', fetcher });
    const body = calls[0]!.init.body as string;
    expect(body).not.toContain('webhookSecret');
    expect(body).not.toContain('WORKER_WEBHOOK_SECRET');
  });

  test('returns the run id from the response', async () => {
    const { fetcher } = makeMockFetcher(
      new Response(JSON.stringify({ id: 'run-abc', status: 'IN_QUEUE' }), { status: 200 }),
    );
    const result = await dispatchToRunpod(BASE_INPUT, { apiKey: 'k', endpointId: 'e', fetcher });
    expect(result.runId).toBe('run-abc');
    expect(result.status).toBe('IN_QUEUE');
  });

  test('defaults status to IN_QUEUE if upstream omits it', async () => {
    const { fetcher } = makeMockFetcher(
      new Response(JSON.stringify({ id: 'run-1' }), { status: 200 }),
    );
    const result = await dispatchToRunpod(BASE_INPUT, { apiKey: 'k', endpointId: 'e', fetcher });
    expect(result.status).toBe('IN_QUEUE');
  });

  test('throws on non-2xx response (caller bubbles up as job failure)', async () => {
    const { fetcher } = makeMockFetcher(new Response('rate limited', { status: 429 }));
    await expect(
      dispatchToRunpod(BASE_INPUT, { apiKey: 'k', endpointId: 'e', fetcher }),
    ).rejects.toThrow(/HTTP 429/);
  });

  test('throws when RunPod response is missing run id (contract violation)', async () => {
    const { fetcher } = makeMockFetcher(new Response('{}', { status: 200 }));
    await expect(
      dispatchToRunpod(BASE_INPUT, { apiKey: 'k', endpointId: 'e', fetcher }),
    ).rejects.toThrow(/missing run id/);
  });

  describe('env-resolution fallback', () => {
    let savedKey: string | undefined;
    let savedEndpoint: string | undefined;

    beforeEach(() => {
      savedKey = process.env.RUNPOD_API_KEY;
      savedEndpoint = process.env.RUNPOD_ENDPOINT_ID;
    });

    afterEach(() => {
      if (savedKey === undefined) delete process.env.RUNPOD_API_KEY;
      else process.env.RUNPOD_API_KEY = savedKey;
      if (savedEndpoint === undefined) delete process.env.RUNPOD_ENDPOINT_ID;
      else process.env.RUNPOD_ENDPOINT_ID = savedEndpoint;
    });

    test('throws when both env vars are missing and cfg is empty', async () => {
      delete process.env.RUNPOD_API_KEY;
      delete process.env.RUNPOD_ENDPOINT_ID;
      await expect(dispatchToRunpod(BASE_INPUT)).rejects.toThrow(/RUNPOD_API_KEY/);
    });

    test('uses env vars when cfg omits them', async () => {
      process.env.RUNPOD_API_KEY = 'env-key';
      process.env.RUNPOD_ENDPOINT_ID = 'env-endpoint';
      const { fetcher, calls } = makeMockFetcher(
        new Response(JSON.stringify({ id: 'run-1' }), { status: 200 }),
      );
      await dispatchToRunpod(BASE_INPUT, { fetcher });
      expect(calls[0]!.url).toContain('/env-endpoint/run');
      const headers = calls[0]!.init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer env-key');
    });
  });
});

describe('buildEventId', () => {
  test('is stable across calls (BullMQ retries reuse the same eventId)', () => {
    expect(buildEventId('ep-1', 'preprocess', 'run-1')).toBe('ep-1:preprocess:run-1');
    expect(buildEventId('ep-1', 'preprocess', 'run-1')).toBe('ep-1:preprocess:run-1');
  });

  test('differs per stage', () => {
    expect(buildEventId('ep-1', 'preprocess', 'run-1')).not.toBe(
      buildEventId('ep-1', 'transcribe', 'run-1'),
    );
  });

  test('differs per episode', () => {
    expect(buildEventId('ep-1', 'preprocess', 'run-1')).not.toBe(
      buildEventId('ep-2', 'preprocess', 'run-1'),
    );
  });

  test('differs per pipelineRunId (intent: reprocess gets a fresh dedup key)', () => {
    expect(buildEventId('ep-1', 'preprocess', 'run-1')).not.toBe(
      buildEventId('ep-1', 'preprocess', 'run-2'),
    );
  });
});

describe('getWebhookUrl', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.API_PUBLIC_URL;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.API_PUBLIC_URL;
    else process.env.API_PUBLIC_URL = saved;
  });

  test('throws when API_PUBLIC_URL is not set', () => {
    delete process.env.API_PUBLIC_URL;
    expect(() => getWebhookUrl()).toThrow(/API_PUBLIC_URL/);
  });

  test('appends /webhooks/runpod', () => {
    process.env.API_PUBLIC_URL = 'https://api.example.com';
    expect(getWebhookUrl()).toBe('https://api.example.com/webhooks/runpod');
  });

  test('strips trailing slashes from the base url', () => {
    process.env.API_PUBLIC_URL = 'https://api.example.com//';
    expect(getWebhookUrl()).toBe('https://api.example.com/webhooks/runpod');
  });
});

describe('isRunpodMode', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.WORKER_MODE;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.WORKER_MODE;
    else process.env.WORKER_MODE = saved;
  });

  test('returns true only for the exact string "runpod"', () => {
    process.env.WORKER_MODE = 'runpod';
    expect(isRunpodMode()).toBe(true);
    process.env.WORKER_MODE = 'Runpod';
    expect(isRunpodMode()).toBe(false);
    process.env.WORKER_MODE = '';
    expect(isRunpodMode()).toBe(false);
    delete process.env.WORKER_MODE;
    expect(isRunpodMode()).toBe(false);
  });
});
