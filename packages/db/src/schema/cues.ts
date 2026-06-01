import {
  pgTable,
  text,
  integer,
  uuid,
  boolean,
  doublePrecision,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { episodes } from './episodes';
import { users } from './users';

export const cues = pgTable(
  'cues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    orderIndex: integer('order_index').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    text: text('text').notNull().default(''),
    styleName: text('style_name').notNull().default('Default'),
    speakerId: text('speaker_id'),
    confidence: doublePrecision('confidence'),
    needsReview: boolean('needs_review').notNull().default(false),
    lastEditedBy: uuid('last_edited_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    episodeOrderIdx: index('cues_episode_order_idx').on(t.episodeId, t.orderIndex),
    episodeStartIdx: index('cues_episode_start_idx').on(t.episodeId, t.startMs),
  }),
);
