# Subtitle.fm

Community-driven fansub platform with AI bootstrap.

## Stack

| Piece | Tech |
|---|---|
| API | Hono on Bun (TypeScript) |
| Web editor | SvelteKit + JASSUB + peaks.js + Yjs |
| Realtime collab server | Hocuspocus (Node) |
| Stremio addon | stremio-addon-sdk (Node) |
| ASR / translation worker | Python + faster-whisper + anime-whisper + Demucs |
| Database | Postgres (Drizzle ORM) |
| Queue | BullMQ on Redis |
| Object storage | Cloudflare R2 |
| GPU host | RunPod serverless RTX 4090 |
| Payments | Lemon Squeezy (merchant of record) |

## Layout

```
subtitle-fm/
├── apps/
│   ├── api/         # Hono REST API
│   ├── web/         # SvelteKit editor
│   ├── stremio/     # Stremio subtitle addon
│   ├── collab/      # Hocuspocus realtime server
│   └── worker/      # Python ASR + translation worker
├── packages/
│   ├── shared/      # Shared TS types
│   ├── db/          # Drizzle schema + migrations
│   └── ass/         # ASS parse/serialize helpers
└── docs/
    └── superpowers/specs/   # Design spec
```

## Prerequisites

- Bun >= 1.3
- Node >= 22 (Hocuspocus runtime)
- Python >= 3.11
- ffmpeg
- Postgres 15+ (local) or Neon (prod)
- Redis (local) or Upstash (prod)

## Setup

```bash
# Install Bun workspace deps
bun install

# Python worker (optional locally — runs on RunPod in prod)
cd apps/worker && uv sync && cd ../..

# Env
cp .env.example .env
# fill in values (DATABASE_URL and REDIS_URL match docker-compose defaults)

# Local services (Postgres 16 + Redis 7)
docker compose up -d

# DB migrations
bun run db:migrate
```

### Regenerating migrations after schema changes

```bash
bun run db:generate   # writes packages/db/migrations/NNNN_*.sql
bun run db:migrate    # applies to DATABASE_URL
```

## Dev

```bash
bun run dev:api      # http://localhost:3000
bun run dev:web      # http://localhost:5173
bun run dev:collab   # ws://localhost:1234
bun run dev:stremio  # http://localhost:7000

# Python worker
cd apps/worker && uv run python -m subtitle_worker
```

## End-to-end smoke test

Phase 1's exit gate. Drives 5 sample episodes through the full pipeline
and verifies each reaches `ready_for_edit`. See
[`docs/runbooks/phase-1-e2e-smoke.md`](docs/runbooks/phase-1-e2e-smoke.md)
for setup and `bun run smoke` to execute.

## Backfill external show IDs

Prepare a reviewed mapping using `apps/api/external-ids.example.json`, then validate it against the target database before writing:

```bash
bun run --filter @subtitle-fm/api backfill:external-ids external-ids.json --dry-run
bun run --filter @subtitle-fm/api backfill:external-ids external-ids.json
```

The backfill is atomic and refuses missing shows, invalid ID formats, duplicate ownership, and overwriting a different existing ID.

## Status

Pre-alpha scaffold. See design doc for roadmap.
