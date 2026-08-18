# Subtitle.fm

[![CI](https://github.com/jouleka/subtitle-fm/actions/workflows/ci.yml/badge.svg)](https://github.com/jouleka/subtitle-fm/actions/workflows/ci.yml)
[![Secret scan](https://github.com/jouleka/subtitle-fm/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/jouleka/subtitle-fm/actions/workflows/secret-scan.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Subtitle.fm is an early-stage, community-driven subtitle production platform. It combines an
AI-assisted transcription and translation pipeline with a browser editor, waveform timing,
glossaries, review workflows, realtime collaboration, and a Stremio subtitle add-on.

> [!IMPORTANT]
> This project is under active development and has not received an independent security audit.
> Only process media you are authorized to use, and review generated subtitles before publishing.

## What is included

- Episode ingestion from authenticated direct uploads or public HTTPS media URLs
- Audio preprocessing, vocal isolation, faster-whisper ASR, and assisted translation
- SvelteKit subtitle editor with ASS rendering, waveform timing, and Yjs collaboration
- Show glossaries, cue review flags, snapshots, branches, audit history, and role-based publishing
- Postgres persistence, Redis/BullMQ jobs, Cloudflare R2 artifacts, and RunPod worker dispatch
- Stremio add-on and versioned API access

## Architecture

| Component            | Technology       | Purpose                                                  |
| -------------------- | ---------------- | -------------------------------------------------------- |
| `apps/web`           | SvelteKit        | Public site and subtitle editor                          |
| `apps/api`           | Hono on Bun      | REST API, auth, ingestion, billing, and webhooks         |
| `apps/collab`        | Hocuspocus + Yjs | Authenticated realtime editing                           |
| `apps/worker-runner` | BullMQ           | Pipeline dispatch and retries                            |
| `apps/worker`        | Python           | ASR, preprocessing, translation, and waveform generation |
| `apps/stremio`       | Stremio SDK      | Subtitle add-on                                          |
| `packages/db`        | Drizzle ORM      | Schema and migrations                                    |
| `packages/shared`    | TypeScript       | Shared contracts and queue payloads                      |
| `packages/ass`       | TypeScript       | ASS subtitle parsing and serialization                   |

The default production blueprint targets Render for the web-facing services, Cloudflare R2 for
objects, Postgres for durable state, Redis for queues, and RunPod for GPU work. These providers are
replaceable; credentials are always supplied at runtime and are never committed.

## Requirements

- [Bun](https://bun.sh/) 1.3 or newer
- Node.js 22 or newer
- Python 3.11 or newer and [uv](https://docs.astral.sh/uv/)
- Docker with Compose (recommended for local Postgres and Redis)
- `ffmpeg` for local worker execution

## Local setup

```bash
git clone https://github.com/jouleka/subtitle-fm.git
cd subtitle-fm

cp .env.example .env
bun install --frozen-lockfile
uv sync --project apps/worker --extra dev --frozen

docker compose up -d postgres redis
bun run db:migrate
```

For local development, fill only the integrations you intend to exercise in `.env`. Generate
secrets with `openssl rand -base64 32`; do not reuse production values. The checked-in database and
Redis URLs match the Compose ports (`5433` and `6380`).

Start services in separate terminals:

```bash
bun run dev:api       # http://localhost:3000
bun run dev:web       # http://localhost:5173
bun run dev:collab    # ws://localhost:1234
bun run dev:worker    # BullMQ dispatcher
bun run dev:stremio   # http://localhost:7000
```

The Python GPU worker can be run separately with:

```bash
uv run --project apps/worker python -m subtitle_worker
```

## Validation

```bash
bun run typecheck
bun test
bun run build

uv run --project apps/worker --extra dev ruff check apps/worker
uv run --project apps/worker --extra dev mypy apps/worker/src
uv run --project apps/worker --extra dev pytest apps/worker/tests
```

The Bun test suite expects the local Postgres and Redis services to be running and migrations to be
applied. GPU-heavy behavior is mocked in unit tests.

## Database migrations

```bash
bun run db:generate
bun run db:migrate
```

Review generated SQL before applying it. Migrations run automatically in the supplied Render API
service before deployment.

## Deployment

[`render.yaml`](render.yaml) describes the API, web app, collaboration server, Stremio add-on, and
worker runner. The GPU image under `apps/worker` is deployed separately to RunPod. Before deploying:

1. Create separate production secrets and storage credentials.
2. Configure Discord OAuth with the production Better Auth callback URL.
3. Apply the Render blueprint and supply all `sync: false` values.
4. Deploy the worker image and configure its signed webhook secret.
5. Verify CORS origins, callback URLs, bucket access, and regional/legal requirements.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report vulnerabilities through
GitHub's private vulnerability reporting flow as described in [SECURITY.md](SECURITY.md)—never put a
credential or exploit detail in a public issue.

## License

Released under the [MIT License](LICENSE). This license applies to the software, not to third-party
media, subtitle text, trademarks, models, or datasets processed with it.
