#!/usr/bin/env bun
import { eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { db } from './lib/db';
import { parseExternalIdMappings, planExternalIdBackfill } from './lib/external-id-backfill';

function usage(): never {
  console.error('usage: bun src/backfill-external-ids.ts <mapping.json> [--dry-run]');
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  const path = args.find((arg) => !arg.startsWith('--'));
  if (!path) usage();
  const file = Bun.file(path);
  if (!(await file.exists())) usage();
  const mappings = parseExternalIdMappings(await file.text());
  const rows = await db
    .select({
      showId: schema.shows.id,
      imdbId: schema.shows.imdbId,
      malId: schema.shows.malId,
      kitsuId: schema.shows.kitsuId,
      anilistId: schema.shows.anilistId,
    })
    .from(schema.shows);
  const plan = planExternalIdBackfill(mappings, rows);
  for (const row of plan) {
    const changes = Object.entries(row.changes)
      .map(([field, value]) => `${field}=${value}`)
      .join(', ');
    console.log(
      `${row.errors.length ? '✗' : changes ? '＋' : '='} ${row.showId}` +
        (changes ? ` — ${changes}` : '') +
        (row.errors.length ? ` — ${row.errors.join(', ')}` : ''),
    );
  }
  if (plan.some((row) => row.errors.length)) process.exit(1);
  if (args.includes('--dry-run')) {
    console.log('[dry-run] mapping is conflict-free; nothing written.');
    process.exit(0);
  }
  await db.transaction(async (tx) => {
    for (const row of plan) {
      if (Object.keys(row.changes).length === 0) continue;
      const updated = await tx
        .update(schema.shows)
        .set(row.changes)
        .where(eq(schema.shows.id, row.showId))
        .returning({ id: schema.shows.id });
      if (updated.length !== 1) throw new Error(`show changed during backfill: ${row.showId}`);
    }
  });
  console.log(
    `[done] updated ${plan.filter((row) => Object.keys(row.changes).length).length} show(s).`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
