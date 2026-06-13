import { and, eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { db } from './db';
import { preprocessQueue } from './queue';
import { JOB_OPTS_DEFAULT, type PreprocessJob } from '@subtitle-fm/shared';
import { log } from './log';
import type { CatalogShow } from './catalog-schema';

export type IngestResult =
  | { status: 'created'; episode: typeof schema.episodes.$inferSelect }
  | { status: 'exists'; existingId: string }
  | { status: 'failed'; error: string };

/**
 * Insert one episode + enqueue its preprocess job, idempotent on
 * (showId, number) via the DB unique index. Shared by the single-create route,
 * the bulk route, and the catalog-import CLI so the insert/enqueue/dedup logic
 * has one home. The caller MUST have already verified the show exists (FK is the
 * backstop). Sequential callers only — bulk relies on per-item autocommit so an
 * in-batch duplicate number conflicts here rather than racing.
 */
export async function ingestEpisode(input: {
  showId: string;
  number: number;
  title?: string;
  sourceUrl: string;
  sourceLanguage: string;
  targetLanguage: string;
}): Promise<IngestResult> {
  const [episode] = await db
    .insert(schema.episodes)
    .values({
      showId: input.showId,
      number: input.number,
      title: input.title ?? null,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      status: 'uploaded',
    })
    .onConflictDoNothing({ target: [schema.episodes.showId, schema.episodes.number] })
    .returning();

  if (!episode) {
    // (showId, number) already exists — surface the existing id so callers can
    // report "skipped" / 409 without a second insert.
    const [existing] = await db
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .where(
        and(eq(schema.episodes.showId, input.showId), eq(schema.episodes.number, input.number)),
      )
      .limit(1);
    if (!existing) return { status: 'failed', error: 'conflict_unresolved' };
    return { status: 'exists', existingId: existing.id };
  }

  const job: PreprocessJob = {
    episodeId: episode.id,
    pipelineRunId: crypto.randomUUID(),
    sourceUrl: input.sourceUrl,
  };
  try {
    await preprocessQueue.add('preprocess', job, { jobId: episode.id, ...JOB_OPTS_DEFAULT });
  } catch {
    // Enqueue failed after the row was inserted. Compensate by deleting the row
    // so the invariant "an episode row always has a queued job" holds — otherwise
    // a retry would skip the now-"existing" orphan forever. Bulk amplifies this.
    try {
      await db.delete(schema.episodes).where(eq(schema.episodes.id, episode.id));
    } catch (delErr) {
      log.error(
        { episodeId: episode.id, err: String(delErr) },
        'episode.enqueue_orphan_cleanup_failed',
      );
    }
    return { status: 'failed', error: 'enqueue_failed' };
  }
  return { status: 'created', episode };
}

export class ShowConflictError extends Error {
  constructor(
    public readonly showId: string,
    public readonly constraint?: string,
  ) {
    super(
      `show "${showId}" conflicts with an existing show` +
        (constraint ? ` on ${constraint}` : ' (slug or external id already taken)'),
    );
    this.name = 'ShowConflictError';
  }
}

// 23505 = unique_violation. drizzle-orm >=0.45 wraps driver errors in a
// DrizzleQueryError, so the postgres.js SQLSTATE/constraint sit on `.cause`;
// older versions surfaced them directly. Check both and return the pg-error
// layer (carrying constraint_name) so the caller can build a clear message.
function asUniqueViolation(e: unknown): { constraint_name?: string } | null {
  const direct = e as { code?: unknown; constraint_name?: string } | null;
  if (direct && direct.code === '23505') return direct;
  const cause = (e as { cause?: { code?: unknown; constraint_name?: string } } | null)?.cause;
  if (cause && cause.code === '23505') return cause;
  return null;
}

export type EnsureShowInput = {
  id: string;
  title: string;
  slug: string;
  description?: string;
  malId?: string;
  anilistId?: string;
  kitsuId?: string;
  coverUrl?: string;
};

/**
 * Ensure a show row exists. v1 semantics: create-if-missing, NEVER update an
 * existing show — re-running a manifest won't overwrite an edited title/cover,
 * and that's reported as `exists` so it's visible rather than silent. A new id
 * whose slug/external-id collides with another show throws ShowConflictError (a
 * clear, actionable operator error) instead of a raw Postgres 23505.
 */
export async function ensureShow(
  input: EnsureShowInput,
): Promise<{ status: 'created' | 'exists' }> {
  const [existing] = await db
    .select({ id: schema.shows.id })
    .from(schema.shows)
    .where(eq(schema.shows.id, input.id))
    .limit(1);
  if (existing) return { status: 'exists' };

  try {
    await db.insert(schema.shows).values({
      id: input.id,
      title: input.title,
      slug: input.slug,
      description: input.description ?? null,
      malId: input.malId ?? null,
      anilistId: input.anilistId ?? null,
      kitsuId: input.kitsuId ?? null,
      coverUrl: input.coverUrl ?? null,
    });
    return { status: 'created' };
  } catch (e) {
    const pg = asUniqueViolation(e);
    if (pg) throw new ShowConflictError(input.id, pg.constraint_name);
    throw e;
  }
}

export interface ShowImportResult {
  showId: string;
  show: 'created' | 'exists' | 'error';
  showError?: string;
  created: { number: number; id: string }[];
  skipped: { number: number; existingId: string }[];
  failed: { number: number; error: string }[];
}

/**
 * Ingest a parsed catalog: for each show, ensure it exists then ingest its
 * episodes. Sequential per show AND per episode (ingestEpisode requires
 * sequential so an in-batch duplicate number conflicts cleanly). Each show is
 * isolated in its own try/catch so one bad show (e.g. a slug collision) never
 * aborts the rest of the batch.
 */
export async function importCatalog(shows: CatalogShow[]): Promise<ShowImportResult[]> {
  const results: ShowImportResult[] = [];
  for (const show of shows) {
    // Declared outside the try so a mid-show throw still reports what was done.
    const created: { number: number; id: string }[] = [];
    const skipped: { number: number; existingId: string }[] = [];
    const failed: { number: number; error: string }[] = [];
    try {
      const ensured = await ensureShow(show);
      for (const ep of show.episodes) {
        const r = await ingestEpisode({
          showId: show.id,
          number: ep.number,
          title: ep.title,
          sourceUrl: ep.sourceUrl,
          sourceLanguage: ep.sourceLanguage,
          targetLanguage: ep.targetLanguage,
        });
        if (r.status === 'created') created.push({ number: ep.number, id: r.episode.id });
        else if (r.status === 'exists')
          skipped.push({ number: ep.number, existingId: r.existingId });
        else failed.push({ number: ep.number, error: r.error });
      }
      results.push({ showId: show.id, show: ensured.status, created, skipped, failed });
    } catch (e) {
      results.push({
        showId: show.id,
        show: 'error',
        showError: e instanceof Error ? e.message : String(e),
        created,
        skipped,
        failed,
      });
    }
  }
  return results;
}
