# syntax=docker/dockerfile:1
FROM oven/bun:1

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile 2>/dev/null || bun install

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
