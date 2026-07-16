#!/usr/bin/env bun
/**
 * Catalog import CLI — bulk-ingest a show/episode manifest SERVER-SIDE (direct
 * DB + queue, no HTTP, no auth; the write routes are session-gated and a CLI
 * can't carry an OAuth session). The HTTP /episodes/bulk endpoint and this CLI
 * share the same ingest core (lib/ingest).
 *
 * Usage:
 *   bun src/import-catalog.ts <manifest.json> [--dry-run]
 *
 * --dry-run validates the manifest and prints the plan WITHOUT touching the DB
 * or Redis (it imports only the side-effect-free schema module). See
 * import-catalog.example.json for the manifest shape.
 */
import { parseCatalog, type CatalogShow } from './lib/catalog-schema';

function usage(): never {
  console.error('usage: bun src/import-catalog.ts <manifest.json> [--dry-run]');
  process.exit(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) usage();

  const file = Bun.file(path);
  if (!(await file.exists())) {
    console.error(`manifest not found: ${path}`);
    process.exit(2);
  }

  let shows: CatalogShow[];
  try {
    shows = parseCatalog(await file.text());
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }

  const totalEpisodes = shows.reduce((n, s) => n + s.episodes.length, 0);
  console.log(`[manifest] ${shows.length} show(s), ${totalEpisodes} episode(s)`);

  if (dryRun) {
    for (const s of shows) {
      const nums = s.episodes.map((e) => `S${e.seasonNumber}E${e.number}`).join(', ');
      console.log(`  • ${s.id} (${s.slug}) — ${s.episodes.length} episode(s): ${nums}`);
    }
    console.log('[dry-run] manifest valid; nothing written.');
    process.exit(0);
  }

  // Real run only: import the DB/queue ingest core now (this is what opens Redis).
  const { importCatalog } = await import('./lib/ingest');
  const { connection } = await import('./lib/queue');

  const results = await importCatalog(shows);

  let createdTotal = 0;
  let skippedTotal = 0;
  let failedTotal = 0;
  let showErrors = 0;
  for (const r of results) {
    createdTotal += r.created.length;
    skippedTotal += r.skipped.length;
    failedTotal += r.failed.length;
    if (r.show === 'error') showErrors += 1;
    const marker = r.show === 'error' ? '✗' : r.show === 'created' ? '＋' : '=';
    const suffix = r.show === 'error' ? ` [show error: ${r.showError}]` : '';
    console.log(
      `${marker} ${r.showId} (${r.show}) — created ${r.created.length}, ` +
        `skipped ${r.skipped.length}, failed ${r.failed.length}${suffix}`,
    );
    for (const f of r.failed)
      console.log(`    ! season ${f.seasonNumber} ep ${f.number}: ${f.error}`);
  }
  console.log(
    `\n[summary] shows: ${results.length} (${showErrors} errored) | ` +
      `episodes created ${createdTotal}, skipped ${skippedTotal}, failed ${failedTotal}`,
  );

  await connection.quit();
  // process.exit (not natural exit): the Postgres pool from getDb() is never
  // exposed/closed, so the event loop would otherwise stay alive. Matches the
  // smoke-test CLI convention.
  process.exit(showErrors === 0 && failedTotal === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
