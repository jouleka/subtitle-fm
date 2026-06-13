#!/usr/bin/env bun
/**
 * Resolve a show from MAL (Jikan) into a catalog manifest, optionally ingesting.
 *
 * Usage:
 *   bun src/resolve-catalog.ts --mal <id> --media-template "<tmpl>" \
 *     [--id <id>] [--slug <slug>] [--ingest]
 *
 * Default: print the resolved manifest JSON to stdout (review it, then
 *   `bun run import <file>`). --ingest resolves AND ingests in one step.
 *
 * Media-URL template placeholders: {number} {number:02} {slug} {malId}.
 * Episode list/titles/numbers are fetched from Jikan; the media URLs come from
 * your template (the catalog owner supplies where the media actually lives).
 */
import { resolveShowFromMal, defaultFetchJson } from './lib/resolve';
import type { CatalogShow } from './lib/catalog-schema';

function argVal(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

function usage(): never {
  console.error(
    'usage: bun src/resolve-catalog.ts --mal <id> --media-template "<tmpl>" [--id <id>] [--slug <slug>] [--ingest]',
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mal = argVal(args, '--mal');
  const mediaTemplate = argVal(args, '--media-template');
  const id = argVal(args, '--id');
  const slug = argVal(args, '--slug');
  const ingest = args.includes('--ingest');
  if (!mal || !mediaTemplate) usage();

  let show: CatalogShow;
  try {
    show = await resolveShowFromMal(mal, mediaTemplate, { fetchJson: defaultFetchJson, id, slug });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  if (!ingest) {
    // Emit a valid manifest (array form) — redirect to a file, then `bun run import`.
    console.log(JSON.stringify([show], null, 2));
    process.exit(0);
  }

  // --ingest: pull in the DB/queue core (opens Redis) only on this path.
  const { importCatalog } = await import('./lib/ingest');
  const { connection } = await import('./lib/queue');
  const [r] = await importCatalog([show]);
  if (!r) {
    console.error('import produced no result');
    await connection.quit();
    process.exit(1);
  }
  const marker = r.show === 'error' ? '✗' : r.show === 'created' ? '＋' : '=';
  console.log(
    `${marker} ${r.showId} (${r.show}) — created ${r.created.length}, ` +
      `skipped ${r.skipped.length}, failed ${r.failed.length}` +
      (r.showError ? ` [show error: ${r.showError}]` : ''),
  );
  for (const f of r.failed) console.log(`    ! ep ${f.number}: ${f.error}`);
  await connection.quit();
  process.exit(r.show === 'error' || r.failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
