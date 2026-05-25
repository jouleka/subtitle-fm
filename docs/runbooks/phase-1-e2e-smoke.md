# Phase 1 End-to-End Smoke Test (SFM-19)

Phase 1's exit gate: 5 anime episodes traverse `uploaded → preprocessing → transcribing → translating → ready_for_edit` within 30 minutes per episode, with usable `.ass` output. The script at [`scripts/smoke-test.ts`](../../scripts/smoke-test.ts) drives the test; this runbook walks you through the setup it depends on.

## Scope & safety

Phase 1 has **no authentication** on the api (auth lands in SFM-20). The driver POSTs arbitrary `sourceUrl` strings and the worker fetches them — that's an SSRF surface. Run this only against localhost or a staging host you fully control. Do not expose the unauthed api to untrusted networks.

## What you need

### Software
- Docker Desktop or colima running (local Postgres + Redis)
- Bun ≥ 1.3, Node ≥ 22
- `ffmpeg` on PATH (only needed if you run the Python worker locally; not needed when the worker runs on a RunPod image that bundles it)

### Accounts + credentials
- **Cloudflare R2** — account + an API token with `Object Read & Write`. You need two buckets: `subtitle-fm-media` (source uploads) and `subtitle-fm-peaks` (waveform peaks, Phase 2 use). Set a lifecycle rule on `media` that's **at least as long as your longest expected queue dwell** — the api hands out 7-day presigned GET URLs to the worker, so a shorter lifecycle would invalidate them mid-pipeline if a stage is stuck. Start with 7 days and tune later.
- **Anthropic API key** — used by the translate stage.
- **RunPod serverless endpoint** running the Python worker image. Build + push the image per [`apps/worker/README.md`](../../apps/worker/README.md#docker--runpod-deploy), then create a serverless endpoint pointing at it. Set `RUNPOD_API_KEY` and `RUNPOD_ENDPOINT_ID` in the api's `.env`. (For a CPU-only / no-RunPod run, leave `WORKER_MODE` unset and the worker-runner stays in **stub mode** — useful for verifying the queue plumbing but the test will reach `ready_for_edit` without real transcripts. Stub mode logs a loud warning on boot.)

### Source media
- 5 anime episode source files (MKV/MP4). Each needs to be reachable as an HTTPS URL the worker can fetch.
- The supported path is: upload each to R2 via `POST /uploads/source`, then use the returned `getUrl` as the `sourceUrl` in the smoke spec.

## Setup

```bash
# Repo deps
bun install

# Env (fill in R2/Anthropic/RunPod values)
cp .env.example .env
$EDITOR .env

# Local services + schema
docker compose up -d
bun run db:migrate
```

## Bring up the api + worker-runner

In separate shells:

```bash
bun run dev:api     # http://localhost:3000
bun run dev:worker  # picks up BullMQ jobs
```

Confirm the api is up:

```bash
curl -s http://localhost:3000/health | jq .
# {"status":"ok","service":"api","timestamp":"..."}
```

## (One-time) upload source videos to R2

For each episode you want to smoke-test:

```bash
# Get a presigned PUT URL
curl -s -X POST http://localhost:3000/uploads/source \
  -H 'Content-Type: application/json' \
  -d '{"contentType":"video/x-matroska"}' | jq .

# Response:
# {
#   "bucket": "subtitle-fm-media",
#   "key": "uploads/<uuid>.mkv",
#   "uploadUrl": "https://<account>.r2.cloudflarestorage.com/...",
#   "uploadExpiresInSec": 900,
#   "getUrl": "https://<account>.r2.cloudflarestorage.com/...",
#   "getExpiresInSec": 604800
# }

# PUT the file to uploadUrl
curl -X PUT --upload-file ./episode-01.mkv "<uploadUrl>"

# Record getUrl — it's what you'll paste into the smoke config
```

Allowed content types: `GET /uploads/source/allowed`.

## Configure the smoke run

Copy the example config and fill in 5 specs:

```bash
cp scripts/smoke-test.episodes.example.json scripts/smoke-test.episodes.json
$EDITOR scripts/smoke-test.episodes.json
```

Each entry needs `showId`, `number`, and `sourceUrl` at minimum. The script creates the show row on demand using `showTitle` and `showSlug` if the show doesn't already exist. The user-side `scripts/smoke-test.episodes.json` is gitignored so personal URLs / show ids stay local.

## Run

```bash
bun run smoke
```

The script:
1. Pre-flight: confirms `GET /health` returns ok.
2. For each spec: ensures the show exists (`GET /shows/:id`, falling back to `POST /shows`).
3. `POST /episodes` for each; if the api returns 409 `episode_exists`, the script picks up the returned existing id and continues polling (so a partial rerun "just works" without manually deleting rows).
4. Polls `GET /episodes/:id` every 10s (override with `SMOKE_POLL_INTERVAL_MS`).
5. Logs every status transition with elapsed-from-submit timestamps.
6. **Run timeout** at 30 minutes total (override with `SMOKE_TIMEOUT_MS`). This is the wall-clock cap on the whole script, NOT a per-episode SLO — see Pass criteria below.
7. Exits non-zero if any episode failed to reach `ready_for_edit`.

Example successful tail:

```
=== Summary ===
✓ hxh-2011#1 → ready_for_edit (total 412.7s, 4 transitions)
    └─ preprocessing at +1.2s
    └─ transcribing at +118.6s
    └─ translating at +312.4s
    └─ ready_for_edit at +412.7s
...
[PASS] all episodes reached ready_for_edit
```

## Pass criteria (Phase 1 exit)

- ✅ All 5 specs reach `ready_for_edit`
- ✅ Per-spec elapsed-from-submit ≤ 30 minutes (script flags `[over SLO]` in the summary for any spec that exceeded the per-episode SLO)
- ✅ Per-stage timing is logged for retrospective analysis
- ✅ Per-episode RunPod cost ≤ $0.05 (verify from RunPod billing dashboard)
- ✅ Spot-check the cues for one episode: names render from glossary, no `\h`/`\N` raw escapes, low-confidence cues show `needs_review=true`

The `.ass` output verification has no automated endpoint yet (the direct-download route is Phase 3, SFM-30). For v0 verification, query Postgres directly:

```sql
SELECT order_index, start_ms, end_ms, text, confidence, needs_review
FROM cues
WHERE episode_id = '<id>'
ORDER BY order_index
LIMIT 20;
```

## Troubleshooting

### Episode wedges in `preprocessing` / `transcribing` / `translating`

- Check `dev:worker` log for `worker.shutdown.start` or unhandled exceptions.
- If `WORKER_MODE=runpod` is set, the worker-runner dispatches to RunPod and *exits* — the webhook receiver advances state. If the webhook never arrives, check:
  - The RunPod endpoint logs for the run id you can find in the worker-runner log line `*.dispatched`.
  - The Python worker's outbound webhook URL — it must point at a publicly reachable `API_PUBLIC_URL` (use `ngrok` or similar in local dev).
  - The HMAC signature header — the Python worker must sign with the same `WORKER_WEBHOOK_SECRET` the api validates against.

### `POST /episodes` returns 404 `show_not_found`

The script creates shows on demand; if you've manually edited the config or run partial, double-check that `showId` matches. If you wiped the DB between runs, re-run the script — it'll recreate the show row.

### `POST /uploads/source` 415 `unsupported_content_type`

Hit `GET /uploads/source/allowed` to see the current allowlist. MKV is `video/x-matroska` (not `video/matroska`).

### Stub mode silently "succeeds"

If `WORKER_MODE` is unset, every stage advances state without actually doing the work. The worker-runner logs a loud `STUB MODE: ...` warning on boot — check the very first line of `dev:worker` output. The smoke test will still report `ready_for_edit`, but the resulting cues will be empty / garbage. Stub mode is for plumbing verification, not Phase 1 sign-off.

### `POST /episodes` 409 `episode_exists`

This is fine — the script detects the 409 and resumes polling against the existing episode id. If you actually want to reset and start fresh, `DELETE FROM episodes WHERE id IN (...)` first.

## What this test does NOT verify

- Subtitle *quality* — spot-check manually
- R2 lifecycle behavior — verify via Cloudflare dashboard separately
- BullMQ behavior under failure / retry — exercised by SFM-17 / SFM-18 forward-only state guard, no automated end-to-end test for retry yet
- Multi-tenant or concurrent submission patterns
- Editor / publish flow — those land in Phase 2 / Phase 3
