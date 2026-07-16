# syntax=docker/dockerfile:1
# Generic container image for the Bun services: api, collab, worker-runner,
# stremio. Build one image per service with --build-arg APP=<name>:
#
#   docker build --build-arg APP=api          -t sfm-api .
#   docker build --build-arg APP=collab       -t sfm-collab .
#   docker build --build-arg APP=worker-runner -t sfm-worker-runner .
#   docker build --build-arg APP=stremio      -t sfm-stremio .
#
# Host-agnostic — works on Fly, Railway, Render, or any container host. The
# Python ASR worker (apps/worker) has its own Dockerfile and runs on RunPod;
# it is NOT one of these images.
#
# Bun runs the TypeScript entrypoint directly, so there is no compile step.
# Each service reads its own config from the environment at runtime (see
# docs/runbooks/deploy.md for the per-service env var matrix). Run DB
# migrations (`bun run --filter @subtitle-fm/db migrate`) once before starting
# the services that touch Postgres.
FROM oven/bun:1 AS runtime

ARG APP=stremio
WORKDIR /app

# The whole monorepo (minus .dockerignore). bun install resolves the workspace
# so apps/<APP> can import @subtitle-fm/{db,shared,ass} from /app/node_modules.
COPY . .
RUN bun install --frozen-lockfile 2>/dev/null || bun install

ENV NODE_ENV=production

# Resolves the ARG at build time, baking the service path into the image.
WORKDIR /app/apps/${APP}
CMD ["bun", "src/index.ts"]
