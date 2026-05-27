import {
  pgTable,
  text,
  uuid,
  timestamp,
  customType,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { episodes } from './episodes';
import { users } from './users';

const bytea = customType<{ data: Uint8Array; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export const snapshots = pgTable(
  'snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    yjsState: bytea('yjs_state').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    episodeIdx: index('snapshots_episode_idx').on(t.episodeId, t.createdAt),
    episodeLabelIdx: uniqueIndex('snapshots_episode_label_idx').on(t.episodeId, t.label),
  }),
);
