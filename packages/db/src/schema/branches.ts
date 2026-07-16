import {
  customType,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AppliedCueConflictDecision } from '@subtitle-fm/shared';
import { episodes } from './episodes';
import { snapshots } from './snapshots';
import { users } from './users';

const bytea = customType<{ data: Uint8Array; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export const subtitleBranchStatusEnum = pgEnum('subtitle_branch_status', ['open', 'merged']);

/** A mutable collaborative fork rooted at one immutable milestone snapshot. */
export const subtitleBranches = pgTable(
  'subtitle_branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    baseSnapshotId: uuid('base_snapshot_id')
      .notNull()
      .references(() => snapshots.id, { onDelete: 'restrict' }),
    yjsState: bytea('yjs_state').notNull(),
    status: subtitleBranchStatusEnum('status').notNull().default('open'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    mergedBy: uuid('merged_by').references(() => users.id, { onDelete: 'set null' }),
    mergeDecisions: jsonb('merge_decisions').$type<AppliedCueConflictDecision[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    mergedAt: timestamp('merged_at', { withTimezone: true }),
  },
  (t) => ({
    episodeIdx: index('subtitle_branches_episode_idx').on(t.episodeId, t.createdAt),
    episodeNameIdx: uniqueIndex('subtitle_branches_episode_name_idx').on(t.episodeId, t.name),
  }),
);
