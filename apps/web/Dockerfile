# syntax=docker/dockerfile:1
FROM oven/bun:1.3.5@sha256:e90cdbaf9ccdb3d4bd693aa335c3310a6004286a880f62f79b18f9b1312a8ec3

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

# SvelteKit's public variables are compiled into the server/client bundle.
# Render exposes service environment variables as Docker build arguments.
ARG PUBLIC_API_URL
ARG PUBLIC_COLLAB_URL
ENV PUBLIC_API_URL=${PUBLIC_API_URL}
ENV PUBLIC_COLLAB_URL=${PUBLIC_COLLAB_URL}

RUN bun run --filter @subtitle-fm/web build

WORKDIR /app/apps/web
ENV NODE_ENV=production
ENV HOST=0.0.0.0
CMD ["bun", "build/index.js"]
