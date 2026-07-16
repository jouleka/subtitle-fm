# Deploy runbook — Subtitle.fm

How to take Subtitle.fm from local-only to a live, reachable deployment. This is
grounded in the actual code (env vars, ports, commands verified against source).

Everything that can be containerized already is: the Bun services share a single
[`Dockerfile`](../../Dockerfile) (built per-service with `--build-arg APP=…`),
the Python ASR worker has [`apps/worker/Dockerfile`](../../apps/worker/Dockerfile)
and runs on RunPod. What's left is **infra you must provision** (accounts) and
wiring env vars.

---

## 1. Architecture — what runs where

| Unit | Type | Port | Runs on | Image |
|------|------|------|---------|-------|
| `apps/api` | Bun HTTP (Hono) | `API_PORT` (3000) | container host, **public** | `Dockerfile` `APP=api` |
| `apps/collab` | Bun WebSocket (Hocuspocus) | `COLLAB_PORT` (1234) | container host, public | `Dockerfile` `APP=collab` |
| `apps/stremio` | Bun HTTP (Stremio addon) | `STREMIO_PORT` (7000) | container host, public | `Dockerfile` `APP=stremio` |
| `apps/worker-runner` | Bun BullMQ consumer | none (no port) | container host, private | `Dockerfile` `APP=worker-runner` |
| `apps/web` | SvelteKit (adapter-node) | Node `PORT` | Vercel or container host | see §6 |
| `apps/worker` | Python ASR/translate | — | **RunPod serverless** | `apps/worker/Dockerfile` |

Managed infra: **Postgres** (Neon), **Redis** (Upstash), **R2** (Cloudflare — already set up), **RunPod** (already set up).

Data flow: web → api (HTTP) + collab (WS). api enqueues jobs to Redis →
worker-runner consumes and dispatches to RunPod → the Python worker POSTs signed
results back to **`api` at `API_PUBLIC_URL`/webhooks/runpod** (so api must be
publicly reachable). api ↔ collab ↔ worker-runner all share Postgres + Redis.

---

## 2. Provision (the part only you can do)

1. **Neon** — create a Postgres project. Copy the pooled connection string → `DATABASE_URL`.
2. **Upstash** — create a Redis database. Copy the `rediss://…` URL → `REDIS_URL`. (BullMQ needs `maxRetriesPerRequest: null`, already set in code.)
3. **R2** — already configured (buckets `subtitle-fm-media`, `subtitle-fm-peaks`). Reuse the existing `R2_*` secrets.
4. **RunPod** — already configured (endpoint `RUNPOD_ENDPOINT_ID`). **Rebuild the endpoint from the latest commit** to pick up the slim CPU image (~2.4 GB vs 6.4 GB). Keep `SKIP_DEMUCS` unset.
5. **Container host** (Fly / Railway / Render) — for api, collab, stremio, worker-runner. Fly needs the `Dockerfile`; Railway/Render can build it or build Bun from source.
6. **Web host** — Vercel (switch web to `@sveltejs/adapter-vercel`) **or** the same container host (current `adapter-node`). See §6.
7. **Discord** — in the Discord developer portal, add the production OAuth redirect URI: `https://<api-domain>/api/auth/callback/discord` (Better Auth's callback path). Keep `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`.
8. Generate a strong **`WORKER_WEBHOOK_SECRET`** and a **`BETTER_AUTH_SECRET`** (`openssl rand -base64 32` each).

---

## 3. Environment variables (per service)

Set these in each host's secret manager. **Secrets** must never be committed or baked into images (`.dockerignore` excludes `.env`).

### Shared (every Postgres/Redis-touching service)
- `DATABASE_URL` *(secret)* — api, collab, worker-runner, migrations. No default; required.
- `REDIS_URL` *(secret)* — api, worker-runner. Default `redis://localhost:6379` (must override).
- `NODE_ENV=production` — api, worker-runner (enables secure auth cookies + JSON logs).
- `LOG_LEVEL=info`

### `api` (public)
- `API_PORT` (default 3000) — or whatever the host injects.
- `API_PUBLIC_URL` *(config)* — the api's own public HTTPS URL. **Critical**: RunPod webhooks call back here.
- `WEB_URL` — the web app's public URL (CORS + Better Auth trusted origins).
- `BETTER_AUTH_URL` — **must equal the api's public URL**.
- `BETTER_AUTH_SECRET` *(secret)*.
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` *(secrets)*.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` *(secrets)*; optional `R2_BUCKET_MEDIA`, `R2_BUCKET_PEAKS` (default to the existing bucket names).
- `WORKER_WEBHOOK_SECRET` *(secret)* — verifies RunPod callbacks. **Must match** the value set on the RunPod endpoint.
- `COLLAB_PORT` (only if api references it for links).
- `COLLAB_INTERNAL_URL` — private HTTP origin for the collab service (exact snapshot capture/restore).
- `COLLAB_SECRET` *(secret)* — must match the collab service; authenticates its internal snapshot API.

### `collab` (public)
- `COLLAB_PORT` (default 1234), `DATABASE_URL`, `COLLAB_SECRET` *(same value as api)*.

### `stremio` (public)
- `STREMIO_PORT` (default 7000; falls back to host-injected `PORT`), `API_PUBLIC_URL` (the stable public API origin used to resolve and serve subtitle URLs).
- BeamUp can build the root `Dockerfile` without a build argument because it defaults to `APP=stremio`. Verify `https://<addon-host>/manifest.json` and a real `/subtitles/...json` response before publishing the manifest URL to Stremio's catalogue.

### `worker-runner` (private)
- `DATABASE_URL`, `REDIS_URL`, `WORKER_CONCURRENCY` (default 2).
- `WORKER_MODE=runpod` — anything else = stub mode (no real dispatch).
- `API_PUBLIC_URL` *(config)* — **required when `WORKER_MODE=runpod`**; the webhook callback target. Code throws if unset.
- `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID` *(secrets)*.
- `WORKER_WEBHOOK_SECRET` *(secret)* — same value as api + the RunPod endpoint.

### `web` (build-time)
- `PUBLIC_API_URL` — **baked at build time** (SvelteKit `$env/static/public`). Set it to the api's public URL **before** `bun run build`; changing it requires a rebuild.
- `PUBLIC_COLLAB_URL` — the collab WS public URL (`wss://…`).

### RunPod endpoint (set in the RunPod dashboard, not here)
`R2_*`, `OPENAI_API_KEY`, `LLM_PROVIDER=openai`, `ASR_DEVICE=cpu`, `ASR_COMPUTE_TYPE=int8`, `WORKER_WEBHOOK_SECRET` (matching api). Leave `SKIP_DEMUCS` unset.

---

## 4. Build & deploy order

```bash
# 0. Migrate the production DB FIRST (idempotent; drizzle.config.ts reads DATABASE_URL)
DATABASE_URL="<neon-url>" bun run --filter @subtitle-fm/db migrate

# 1. Build + deploy the four Bun services (per host; example with plain docker)
docker build --build-arg APP=api            -t sfm-api .
docker build --build-arg APP=collab         -t sfm-collab .
docker build --build-arg APP=stremio        -t sfm-stremio .
docker build --build-arg APP=worker-runner  -t sfm-worker-runner .
# push to the host's registry + deploy each with its env vars from §3.

# 2. Rebuild the RunPod endpoint from the latest commit (slim CPU image).

# 3. Build + deploy web with PUBLIC_API_URL pointing at the deployed api (§6).
```

Deploy order that avoids dangling references: **migrate → api (gives you `API_PUBLIC_URL`) → collab + stremio + worker-runner (need `API_PUBLIC_URL`) → web (needs `PUBLIC_API_URL`)**. Set `WEB_URL`/`BETTER_AUTH_URL` on api once the domains are known (a second api deploy is fine).

---

## 5. The webhook loop (don't skip)

For the AI pipeline to complete, RunPod must reach the api:
1. `worker-runner` dispatches with `webhookUrl = ${API_PUBLIC_URL}/webhooks/runpod`.
2. The Python worker POSTs results there with `X-Signature-256 = HMAC-SHA256(body, WORKER_WEBHOOK_SECRET)`.
3. api verifies the signature and advances the episode.

So: `API_PUBLIC_URL` must be the api's real public HTTPS URL, and
`WORKER_WEBHOOK_SECRET` must be **identical** on api, worker-runner, and the
RunPod endpoint. (Locally this was bridged with an ngrok tunnel; in prod it's the
api's domain.)

---

## 6. Web (SvelteKit)

Currently uses `@sveltejs/adapter-node` → `bun run --filter @subtitle-fm/web build` produces a Node server (`apps/web/build/index.js`), run with `node apps/web/build/index.js`.

- **Container host**: add a web Dockerfile that runs the adapter-node build (note `PUBLIC_API_URL`/`PUBLIC_COLLAB_URL` are build args, not runtime).
- **Vercel**: swap to `@sveltejs/adapter-vercel` in `apps/web/svelte.config.js`, set `PUBLIC_API_URL`/`PUBLIC_COLLAB_URL` as Vercel build env, and deploy. (Recommended — least ops.)

---

## 7. Verify (post-deploy)

```bash
# Liveness
curl -sf https://<api-domain>/health        # -> {"status":"ok","service":"api",...}

# Full pipeline (creates a show + episode, polls to ready_for_edit)
API_URL=https://<api-domain> bun scripts/smoke-test.ts scripts/smoke-test.episodes.json
#   exit 0 = an episode went uploaded -> ... -> ready_for_edit through real infra.
```

Then log in via Discord on the web app and open an episode in the editor to
confirm the collab server + cues render.

---

## 8. Gotchas

- **`API_PUBLIC_URL` everywhere it's needed** — worker-runner throws on boot without it in runpod mode; the webhook silently can't return without it.
- **`WORKER_WEBHOOK_SECRET` must match in 3 places** (api, worker-runner, RunPod). A mismatch = callbacks rejected (401/503) and episodes stall.
- **`BETTER_AUTH_URL` = api public URL** and the Discord redirect URI must be registered for prod, or OAuth fails.
- **Web `PUBLIC_API_URL` is build-time** — a wrong value means a rebuild, not an env tweak.
- **Migrations before start** — services that import `@subtitle-fm/db` assume the schema exists.
- **Image size** — the slim RunPod worker (CPU torch) is ~2.4 GB; rebuild the endpoint to get it. Bun service images install the full workspace; per-service dep pruning is a future optimization.
- **`.env` is gitignored and `.dockerignore`'d** — never the source of prod secrets; use each host's secret store.
