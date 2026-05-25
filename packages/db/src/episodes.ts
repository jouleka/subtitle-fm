import { and, eq, inArray, sql } from 'drizzle-orm';
import type { EpisodeStatus } from '@subtitle-fm/shared';
import { episodes } from './schema/episodes';
import type { Db } from './index';

export type AdvanceResult =
  | { advanced: true; status: EpisodeStatus }
  | { advanced: false; currentStatus: EpisodeStatus };

/**
 * Atomic, forward-only episode status transition.
 *
 * The UPDATE has a `WHERE status IN (from)` guard so a retry against an
 * already-advanced episode will not rewind state. Returns:
 *   - `{ advanced: true, status }` on a real transition.
 *   - `{ advanced: false, currentStatus }` if the episode exists but is
 *     no longer in any of the expected source states (caller decides
 *     whether to no-op or re-enqueue downstream).
 *
 * Throws if the episode doesn't exist — that's a fatal job error, not a
 * silent skip.
 */
export async function advanceEpisodeStatus(
  db: Db,
  episodeId: string,
  options: { from: ReadonlyArray<EpisodeStatus>; to: EpisodeStatus },
): Promise<AdvanceResult> {
  const fromList = [...options.from];
  // inArray([]) on drizzle has historically rendered to `WHERE x IN ()`,
  // which is a SQL error. Fail loud (Rule 12) so a bad caller hits a clear
  // exception rather than silently no-op-ing.
  if (fromList.length === 0) {
    throw new Error('advanceEpisodeStatus: `from` must not be empty');
  }

  const updated = await db
    .update(episodes)
    .set({ status: options.to, updatedAt: sql`now()` })
    .where(and(eq(episodes.id, episodeId), inArray(episodes.status, fromList)))
    .returning({ status: episodes.status });

  if (updated.length > 0) {
    return { advanced: true, status: options.to };
  }

  const existing = await db
    .select({ status: episodes.status })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1);

  if (existing.length === 0) {
    throw new Error(`episode ${episodeId} not found`);
  }

  return { advanced: false, currentStatus: existing[0]!.status as EpisodeStatus };
}

/**
 * Mark an episode failed from any non-terminal state. Used by webhook
 * handlers on RunPod failure callbacks.
 */
export async function failEpisode(db: Db, episodeId: string): Promise<AdvanceResult> {
  return advanceEpisodeStatus(db, episodeId, {
    from: ['uploaded', 'preprocessing', 'transcribing', 'translating', 'ready_for_edit', 'in_review'],
    to: 'failed',
  });
}
