import { eq, sql } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { db } from './db';

type EpisodeStatus =
  | 'uploaded'
  | 'preprocessing'
  | 'transcribing'
  | 'translating'
  | 'ready_for_edit'
  | 'in_review'
  | 'published'
  | 'failed';

/**
 * Update an episode's status and bump updatedAt. Throws if the row is
 * missing — that's a fatal job error and the caller should let BullMQ
 * retry (or fail-after-attempts) rather than silently no-op.
 *
 * TODO(retry-safety): this does not enforce forward-only transitions.
 * On retry, an already-advanced episode will be rewound. Fix when RunPod
 * webhooks land — then we need: (a) inArray(status, from) guard, (b)
 * idempotent re-enqueue of downstream when the advance is a no-op.
 */
export async function setEpisodeStatus(episodeId: string, status: EpisodeStatus) {
  const [row] = await db
    .update(schema.episodes)
    .set({ status, updatedAt: sql`now()` })
    .where(eq(schema.episodes.id, episodeId))
    .returning();
  if (!row) {
    throw new Error(`episode ${episodeId} not found`);
  }
  return row;
}
