import {
  pgTable,
  text,
  integer,
  uuid,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { shows } from './shows';
import { seasons } from './seasons';

export const episodeStatusEnum = pgEnum('episode_status', [
  'uploaded',
  'preprocessing',
  'transcribing',
  'translating',
  'ready_for_edit',
  'in_review',
  'published',
  'failed',
]);

export const episodes = pgTable(
  'episodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    showId: text('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    seasonId: uuid('season_id').references(() => seasons.id, { onDelete: 'set null' }),
    title: text('title'),
    sourceLanguage: text('source_language').notNull().default('ja'),
    targetLanguage: text('target_language').notNull().default('en'),
    status: episodeStatusEnum('status').notNull().default('uploaded'),
    audioUrl: text('audio_url'),
    peaksUrl: text('peaks_url'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // UNIQUE so dedup is a DB invariant (bulk ingest uses onConflictDoNothing on
    // this). NOTE: when the per-season model lands (SFM-66), this becomes
    // (show_id, season_id, number) NULLS NOT DISTINCT via a follow-up migration.
    showNumberIdx: uniqueIndex('episodes_show_number_idx').on(t.showId, t.number),
    statusIdx: index('episodes_status_idx').on(t.status),
  }),
);
