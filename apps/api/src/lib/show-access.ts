import { and, eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { db } from './db';

export const MERGE_REPUTATION_THRESHOLD = 10;
export const PUBLISH_REPUTATION_THRESHOLD = MERGE_REPUTATION_THRESHOLD * 3;

const MERGE_ROLES = new Set(['tl', 'tlc', 'qc']);
const PUBLISH_ROLES = new Set(['tl', 'qc']);

export interface ShowAccess {
  reputation: number;
  globalRole: (typeof schema.userRoleEnum.enumValues)[number];
  showRole: (typeof schema.showRoleEnum.enumValues)[number] | null;
  thresholds: { merge: number; publish: number };
  canSuggest: boolean;
  canMerge: boolean;
  canPublish: boolean;
}

/** Resolve fresh authorization state from Postgres so role/reputation changes apply immediately. */
export async function getShowAccess(userId: string, showId: string): Promise<ShowAccess | null> {
  const [row] = await db
    .select({
      reputation: schema.users.reputation,
      globalRole: schema.users.role,
      showRole: schema.showRoleAssignments.role,
    })
    .from(schema.users)
    .leftJoin(
      schema.showRoleAssignments,
      and(
        eq(schema.showRoleAssignments.userId, schema.users.id),
        eq(schema.showRoleAssignments.showId, showId),
      ),
    )
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!row) return null;

  const admin = row.globalRole === 'admin';
  return {
    reputation: row.reputation,
    globalRole: row.globalRole,
    showRole: row.showRole,
    thresholds: {
      merge: MERGE_REPUTATION_THRESHOLD,
      publish: PUBLISH_REPUTATION_THRESHOLD,
    },
    canSuggest: true,
    canMerge:
      admin ||
      (row.reputation >= MERGE_REPUTATION_THRESHOLD && MERGE_ROLES.has(row.showRole ?? '')),
    canPublish:
      admin ||
      (row.reputation >= PUBLISH_REPUTATION_THRESHOLD && PUBLISH_ROLES.has(row.showRole ?? '')),
  };
}
