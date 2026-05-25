#!/usr/bin/env bun
/**
 * Phase 1 end-to-end smoke test (SFM-19).
 *
 * For each spec in the config file:
 *   1. ensure the show row exists (POST /shows if missing)
 *   2. POST /episodes (api enqueues `preprocess` to BullMQ)
 *   3. poll GET /episodes/:id until status reaches `ready_for_edit` (success)
 *      or `failed` (early-exit that spec) or the per-spec timeout fires
 *   4. report every stage transition with timestamps
 *
 * Exit code: 0 if every spec reached `ready_for_edit`, 1 otherwise.
 *
 * Usage:
 *   bun scripts/smoke-test.ts [path/to/specs.json]
 *
 * Defaults to scripts/smoke-test.episodes.json. See the example file in
 * this directory for the shape and the runbook at
 * docs/runbooks/phase-1-e2e-smoke.md for the full procedure.
 */

interface EpisodeSpec {
  /** Foreign key into `shows`. Created if missing. */
  showId: string;
  /** Title used when the show is created on the fly. */
  showTitle?: string;
  /** URL-safe slug used when the show is created. Derived from showId if omitted. */
  showSlug?: string;
  /** Episode number within the show. Unique per (showId, number). */
  number: number;
  /** Optional episode title. */
  title?: string;
  /**
   * URL the worker will fetch as the source media. Typically the `getUrl`
   * returned by POST /uploads/source.
   */
  sourceUrl: string;
}

interface Tracking {
  id: string;
  spec: EpisodeSpec;
  createdAt: number;
  transitions: Array<{ status: string; at: number }>;
  done: boolean;
  failed: boolean;
}

const API_URL = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const POLL_INTERVAL_MS = Number(process.env.SMOKE_POLL_INTERVAL_MS ?? 10_000);
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 30 * 60 * 1000);
// Phase 1's exit gate is exactly `ready_for_edit`. Reaching `in_review` or
// `published` would be anomalous in Phase 1 (no editor / publish path exists
// yet) — flag those as not-yet-successful so a state-machine bug shows up
// as a timeout instead of a silent pass.
const SUCCESS_STATUSES = new Set(['ready_for_edit']);
const TERMINAL_FAIL_STATUSES = new Set(['failed']);
const SLO_SEC_PER_SPEC = 30 * 60;

async function preflight(): Promise<void> {
  const resp = await fetch(`${API_URL}/health`);
  if (!resp.ok) {
    throw new Error(`pre-flight: api /health returned ${resp.status}`);
  }
  const body = (await resp.json()) as { status: string };
  if (body.status !== 'ok') {
    throw new Error(`pre-flight: api /health reports status=${body.status}`);
  }
  console.log(`[preflight] api OK at ${API_URL}`);
}

async function ensureShow(spec: EpisodeSpec): Promise<void> {
  const getResp = await fetch(`${API_URL}/shows/${encodeURIComponent(spec.showId)}`);
  if (getResp.ok) return;
  if (getResp.status !== 404) {
    throw new Error(`GET /shows/${spec.showId} returned ${getResp.status}`);
  }
  const createResp = await fetch(`${API_URL}/shows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: spec.showId,
      title: spec.showTitle ?? spec.showId,
      slug:
        spec.showSlug ??
        spec.showId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, ''),
    }),
  });
  if (!createResp.ok) {
    throw new Error(`POST /shows failed: ${createResp.status} ${await createResp.text()}`);
  }
}

async function createEpisode(spec: EpisodeSpec): Promise<string> {
  const resp = await fetch(`${API_URL}/episodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      showId: spec.showId,
      number: spec.number,
      title: spec.title,
      sourceUrl: spec.sourceUrl,
    }),
  });
  // 409 = (showId, number) already exists. The api returns the existing id
  // in the body so reruns "just work" without operators wiping the DB.
  if (resp.status === 409) {
    const body = (await resp.json()) as { error: string; id?: string };
    if (typeof body.id === 'string' && body.id.length > 0) {
      console.log(
        `  ↻ episode_exists for ${spec.showId}#${spec.number}; resuming poll on ${body.id}`,
      );
      return body.id;
    }
    throw new Error(`POST /episodes 409 missing id in body: ${JSON.stringify(body)}`);
  }
  if (!resp.ok) {
    throw new Error(`POST /episodes failed: ${resp.status} ${await resp.text()}`);
  }
  const body = (await resp.json()) as { id?: unknown };
  if (typeof body.id !== 'string' || body.id.length === 0) {
    throw new Error(
      `POST /episodes returned non-string id (api contract regression?): ${JSON.stringify(body)}`,
    );
  }
  return body.id;
}

async function getStatus(id: string): Promise<string> {
  const resp = await fetch(`${API_URL}/episodes/${id}`);
  if (!resp.ok) throw new Error(`GET /episodes/${id} returned ${resp.status}`);
  const body = (await resp.json()) as { status: string };
  return body.status;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function elapsedSec(from: number, to: number): string {
  return ((to - from) / 1000).toFixed(1);
}

async function pollAll(tracking: Tracking[]): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    if (tracking.every((t) => t.done)) return;

    await Promise.all(
      tracking.map(async (t) => {
        if (t.done) return;
        try {
          const status = await getStatus(t.id);
          const lastTransition = t.transitions[t.transitions.length - 1];
          const last = lastTransition ? lastTransition.status : '(none)';
          if (status !== last) {
            t.transitions.push({ status, at: Date.now() });
            console.log(
              `  [${shortId(t.id)}] ${last} → ${status} (+${elapsedSec(t.createdAt, Date.now())}s)`,
            );
          }
          if (SUCCESS_STATUSES.has(status)) t.done = true;
          if (TERMINAL_FAIL_STATUSES.has(status)) {
            t.done = true;
            t.failed = true;
          }
        } catch (e) {
          console.error(`  ! [${shortId(t.id)}] poll error: ${(e as Error).message}`);
        }
      }),
    );

    if (!tracking.every((t) => t.done)) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  console.error(`[poll] run timeout after ${TIMEOUT_MS / 60_000} min`);
}

async function loadSpecs(path: string): Promise<EpisodeSpec[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`config not found: ${path}`);
  }
  const parsed = JSON.parse(await file.text()) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`config ${path} must be a non-empty JSON array of episode specs`);
  }
  for (const entry of parsed) {
    const s = entry as Partial<EpisodeSpec>;
    if (!s.showId || !s.sourceUrl || typeof s.number !== 'number') {
      throw new Error(
        `invalid spec; required keys: showId (string), number (int), sourceUrl (string). Got: ${JSON.stringify(entry)}`,
      );
    }
    if (s.sourceUrl.includes('REPLACE_ME')) {
      throw new Error(
        `spec ${s.showId}#${s.number}: sourceUrl still contains REPLACE_ME — fill in the config first`,
      );
    }
  }
  return parsed as EpisodeSpec[];
}

async function main(): Promise<void> {
  const configPath = process.argv[2] ?? 'scripts/smoke-test.episodes.json';
  console.log(`[config] loading ${configPath}`);
  const specs = await loadSpecs(configPath);
  console.log(`[config] ${specs.length} episode spec(s)`);

  console.log('\n=== Pre-flight ===');
  await preflight();

  console.log('\n=== Ensure shows ===');
  for (const spec of specs) {
    await ensureShow(spec);
    console.log(`  ✓ show ready: ${spec.showId}`);
  }

  console.log('\n=== Submit episodes ===');
  const tracking: Tracking[] = [];
  for (const spec of specs) {
    const id = await createEpisode(spec);
    tracking.push({
      // transitions starts empty; the first poll records the first OBSERVED
      // status. Avoids a fabricated 'uploaded' entry that could mask a
      // bug where the api inserts in a different default state.
      id,
      spec,
      createdAt: Date.now(),
      transitions: [],
      done: false,
      failed: false,
    });
    console.log(`  ✓ submitted: ${spec.showId}#${spec.number} → ${id}`);
  }

  console.log(
    `\n=== Polling every ${POLL_INTERVAL_MS / 1000}s, timeout ${TIMEOUT_MS / 60_000} min ===`,
  );
  await pollAll(tracking);

  console.log('\n=== Summary ===');
  let allOk = true;
  for (const t of tracking) {
    const lastTransition = t.transitions[t.transitions.length - 1];
    const finalStatus = lastTransition ? lastTransition.status : '(no transitions observed)';
    const totalSec = Number(elapsedSec(t.createdAt, Date.now()));
    const ok = !t.failed && t.done;
    if (!ok) allOk = false;
    const symbol = t.failed ? '✗' : t.done ? '✓' : '⏱';
    const sloFlag = totalSec > SLO_SEC_PER_SPEC ? ' [over SLO]' : '';
    console.log(
      `${symbol} ${t.spec.showId}#${t.spec.number} → ${finalStatus} ` +
        `(total ${totalSec.toFixed(1)}s, ${t.transitions.length} transitions)${sloFlag}`,
    );
    for (const trans of t.transitions) {
      console.log(`    └─ ${trans.status} at +${elapsedSec(t.createdAt, trans.at)}s`);
    }
  }

  console.log(
    allOk
      ? '\n[PASS] all episodes reached ready_for_edit'
      : '\n[FAIL] one or more episodes did not reach ready_for_edit',
  );
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', (e as Error).message);
  process.exit(1);
});
