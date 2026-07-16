import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { episodes } from './episodes';
import { users } from './users';

/** Append-only attributed changes emitted by the collaborative editor. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    cueId: uuid('cue_id').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    fieldChanged: text('field_changed').notNull(),
    oldValue: jsonb('old_value').$type<unknown>(),
    newValue: jsonb('new_value').$type<unknown>(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_episode_ts_idx').on(table.episodeId, table.ts),
    index('audit_log_episode_cue_ts_idx').on(table.episodeId, table.cueId, table.ts),
  ],
);
