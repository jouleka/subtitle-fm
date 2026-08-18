# Security best-practices review

Reviewed 2026-08-18 against the repository's TypeScript/Bun/Hono, SvelteKit, Hocuspocus, and Python
worker code. This is a source review and automated validation pass, not an independent penetration
test.

## Findings

1. **High — long-lived web session token reached browser JavaScript (fixed).** The editor previously
   reused the Better Auth session token as its WebSocket credential. The layout now returns only the
   user object (`apps/web/src/routes/+layout.server.ts:4-22`), while the authenticated editor load
   requests a separate ticket (`apps/web/src/routes/episodes/[id]/edit/+page.server.ts:22-49`). The
   API issues an HMAC-signed, no-store, 60-second ticket (`apps/api/src/routes/account.ts:21-32`), and
   ticket verification rejects tampering, expiry, malformed claims, and validity over 120 seconds
   (`packages/shared/src/collab-ticket.ts:64-110`).

2. **High — worker-side server-side request forgery through media URLs (fixed).** A submitted source
   URL could previously follow redirects to loopback, private-network, link-local, or cloud metadata
   addresses. The API now accepts credential-free HTTPS URLs (with a local-only HTTP exception for
   development) at `apps/api/src/lib/source-url.ts:1-14`. The worker independently resolves every
   initial and redirected target, requires all resolved addresses to be globally routable, limits
   redirect depth, and bounds downloaded bytes at
   `apps/worker/src/subtitle_worker/safe_download.py:30-107`.

3. **High — anonymous object-storage presigning enabled cost and storage abuse (fixed).** The public
   upload metadata endpoint remains readable, but creating R2 PUT/GET URLs now requires a valid
   session at `apps/api/src/routes/uploads.ts:28-65`. The browser explicitly includes its HttpOnly
   cookie in the presign request.

4. **Medium — missing browser and API security headers (fixed).** The SvelteKit application now has a
   restrictive CSP covering scripts, WebAssembly, workers, frames, forms, objects, storage uploads,
   and media at `apps/web/svelte.config.js:12-42`. Every web response also receives HSTS,
   `nosniff`, frame denial, referrer, and permissions policies at `apps/web/src/hooks.server.ts:14-42`.
   Hono applies its secure-header middleware globally at `apps/api/src/index.ts:26-38`.

5. **Medium — signed webhook bodies were unbounded before verification (fixed).** Lemon Squeezy
   requests are capped at 1 MiB (`apps/api/src/routes/webhooks-lemonsqueezy.ts:18-24`) and RunPod
   requests at 10 MiB (`apps/api/src/routes/webhooks-runpod.ts:78-84`) before body buffering, HMAC
   verification, or JSON parsing.

6. **Low — one reviewed development-only dependency advisory remains (accepted).**
   `GHSA-67mh-4wv8-2f99` affects `esbuild@0.18.20`, which is present only under the Drizzle Kit
   migration CLI's `@esbuild-kit/esm-loader` path. Production Vite uses a patched esbuild version,
   and the vulnerable scenario requires running the affected development server. `bun run audit`
   fails for every advisory except this exact ID and also verifies that the known dependency path
   remains development-only. Remove the exception when Drizzle Kit removes the old loader.

7. **Informational — preserved history contains a legacy author email (accepted for history
   preservation).** No credentials were found in 165 commits, but raw Git metadata includes the
   maintainer's historical Gmail author address. Removing it would require rewriting commit IDs.
   The repository preparation intentionally preserves all commits and references; future commits use
   the GitHub noreply address.

## Validation completed

- Gitleaks 8.30.1 scanned all 167 commits and the overlaid working tree with no leaks.
- 484 Bun/TypeScript tests passed against Postgres 16 and Redis 7.
- TypeScript and Svelte checks completed with zero errors; seven existing Svelte warnings remain.
- The complete production build succeeded.
- 125 Python worker tests passed; Ruff and strict mypy completed cleanly.
- `pip-audit` found no known vulnerabilities in the locked production worker dependency set.
- `bun run audit` found no unreviewed advisories.
- Actionlint 1.7.12 validated every GitHub Actions workflow.

## Operational follow-up

- Keep GitHub private vulnerability reporting, Dependabot, secret scanning, and CodeQL enabled.
- Treat all current deployment credentials as environment-only values and rotate any value if it is
  ever printed, pasted into an issue, or exposed in a build log.
- Re-run this review after authentication, media ingestion, billing, or worker-network changes.
