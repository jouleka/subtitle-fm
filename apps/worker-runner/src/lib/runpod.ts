/**
 * RunPod serverless dispatcher.
 *
 * Calls POST /v2/{endpointId}/run with the job input. The Python image
 * picks up the input, runs the actual ASR/translation work, and POSTs a
 * formatted callback to our /webhooks/runpod (signed with HMAC using its
 * own env-resident WORKER_WEBHOOK_SECRET — we never ship the secret in
 * the input).
 *
 * Default: stub mode. WORKER_MODE=runpod flips this dispatcher on.
 */

export type RunpodStage = 'preprocess' | 'transcribe' | 'translate';

export interface RunpodInput {
  episodeId: string;
  stage: RunpodStage;
  /** Idempotency key the Python worker echoes back in the webhook payload. */
  eventId: string;
  /** Per-pass id threaded through every stage; the worker echoes this in
   * the webhook payload so the receiver can enqueue the next stage with
   * the same id. */
  pipelineRunId: string;
  /** Where the Python worker POSTs its signed completion callback. */
  webhookUrl: string;
  /** Source media URL — required for preprocess. */
  sourceUrl?: string;
  /** Preprocessed audio URL — required for transcribe. */
  audioUrl?: string;
  /** Transcript URL — required for translate. */
  transcriptUrl?: string;
}

export interface RunpodDispatchResult {
  runId: string;
  status: string;
}

/**
 * The fetch shape we actually use. `typeof fetch` in Bun pulls in extras
 * like `.preconnect` that test mocks don't implement; narrowing here keeps
 * the injection ergonomic.
 */
export type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RunpodConfig {
  apiKey?: string;
  endpointId?: string;
  baseUrl?: string;
  /** Injectable fetch for tests. */
  fetcher?: FetchLike;
}

const DEFAULT_BASE_URL = 'https://api.runpod.ai/v2';

export async function dispatchToRunpod(
  input: RunpodInput,
  cfg: RunpodConfig = {},
): Promise<RunpodDispatchResult> {
  const apiKey = cfg.apiKey ?? process.env.RUNPOD_API_KEY;
  const endpointId = cfg.endpointId ?? process.env.RUNPOD_ENDPOINT_ID;
  if (!apiKey || !endpointId) {
    throw new Error('RunPod not configured: set RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID');
  }
  const baseUrl = cfg.baseUrl ?? DEFAULT_BASE_URL;
  const fetcher = cfg.fetcher ?? fetch;
  const url = `${baseUrl}/${endpointId}/run`;

  const resp = await fetcher(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input }),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`RunPod dispatch failed: HTTP ${resp.status} ${errBody}`);
  }

  const data = (await resp.json()) as { id?: string; status?: string };
  if (!data.id) {
    throw new Error(`RunPod response missing run id: ${JSON.stringify(data)}`);
  }
  return { runId: data.id, status: data.status ?? 'IN_QUEUE' };
}

/**
 * Stable across BullMQ retries within one pipeline pass, unique across
 * passes: `${episodeId}:${stage}:${pipelineRunId}`. BullMQ retries reuse
 * the same payload (same pipelineRunId) so the receiver's PK dedup catches
 * any double-callback. A legitimate reprocess mints a fresh pipelineRunId,
 * so its webhooks aren't dropped as duplicates.
 */
export function buildEventId(
  episodeId: string,
  stage: RunpodStage,
  pipelineRunId: string,
): string {
  return `${episodeId}:${stage}:${pipelineRunId}`;
}

/**
 * Compose our public webhook URL from API_PUBLIC_URL. Throws if missing —
 * if you're trying to run in RunPod mode, you must know your own callback
 * address.
 */
export function getWebhookUrl(): string {
  const base = process.env.API_PUBLIC_URL;
  if (!base) throw new Error('API_PUBLIC_URL not configured');
  return `${base.replace(/\/+$/, '')}/webhooks/runpod`;
}

export function isRunpodMode(): boolean {
  return process.env.WORKER_MODE === 'runpod';
}
