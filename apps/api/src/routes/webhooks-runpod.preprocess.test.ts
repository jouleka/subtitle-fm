import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { db } from '../lib/db';
import { computeHmacSha256Hex } from '../lib/hmac';

const SECRET = 'webhook-preprocess-test-secret';
const SHOW = 'sfm49-waveform-show';
const EPISODE = '49999999-1111-4000-8000-000000000001';
const PIPELINE_RUN = '49999999-1111-4000-8000-000000000002';
const EVENT = 'sfm49:preprocess:1';

const transcribeAddMock = mock(async () => ({}));
mock.module('../lib/queue', () => ({
  preprocessQueue: { add: mock(async () => ({})) },
  transcribeQueue: { add: transcribeAddMock },
  translateQueue: { add: mock(async () => ({})) },
  publishQueue: { add: mock(async () => ({})) },
  connection: {},
}));

process.env.WORKER_WEBHOOK_SECRET = SECRET;
process.env.API_PUBLIC_URL = 'https://api.example/';
const { app } = await import('../index');

async function cleanup() {
  await db.delete(schema.webhookEvents).where(eq(schema.webhookEvents.episodeId, EPISODE));
  await db.delete(schema.episodes).where(eq(schema.episodes.id, EPISODE));
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW));
}

function signedRequest(payload: unknown) {
  const body = JSON.stringify(payload);
  return app.request('/webhooks/runpod', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'X-Signature-256': `sha256=${computeHmacSha256Hex(body, SECRET)}`,
    },
  });
}

beforeAll(async () => {
  await cleanup();
  await db.insert(schema.shows).values({ id: SHOW, title: 'SFM-49', slug: SHOW });
});

beforeEach(async () => {
  transcribeAddMock.mockReset();
  transcribeAddMock.mockImplementation(async () => ({}));
  await db.delete(schema.webhookEvents).where(eq(schema.webhookEvents.episodeId, EPISODE));
  await db.delete(schema.episodes).where(eq(schema.episodes.id, EPISODE));
  await db.insert(schema.episodes).values({
    id: EPISODE,
    showId: SHOW,
    number: 1,
    status: 'preprocessing',
  });
});

afterAll(async () => {
  await cleanup();
});

describe('preprocess completion webhook', () => {
  test('persists the stable waveform URL and enqueues transcription', async () => {
    const res = await signedRequest({
      eventId: EVENT,
      episodeId: EPISODE,
      pipelineRunId: PIPELINE_RUN,
      status: 'completed',
      stage: 'preprocess',
      output: {
        audioKey: `stage/preprocess/${EPISODE}.wav`,
        peaksKey: `${EPISODE}.dat`,
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', enqueued: 'transcribe' });
    const [episode] = await db
      .select({ status: schema.episodes.status, peaksUrl: schema.episodes.peaksUrl })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, EPISODE));
    expect(episode).toEqual({
      status: 'transcribing',
      peaksUrl: `https://api.example/episodes/${EPISODE}/peaks.dat`,
    });
    expect(transcribeAddMock).toHaveBeenCalledTimes(1);
  });

  test('rejects a waveform key belonging to another episode', async () => {
    const res = await signedRequest({
      eventId: `${EVENT}:bad-key`,
      episodeId: EPISODE,
      pipelineRunId: PIPELINE_RUN,
      status: 'completed',
      stage: 'preprocess',
      output: {
        audioKey: `stage/preprocess/${EPISODE}.wav`,
        peaksKey: '00000000-0000-0000-0000-000000000000.dat',
      },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_payload' });
    expect(transcribeAddMock).not.toHaveBeenCalled();
  });
});
