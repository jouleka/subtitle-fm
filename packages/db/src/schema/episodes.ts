import {
  pgTable,
  text,
  integer,
  uuid,
  timestamp,
  pgEnum,
  index,
  unique,
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
  'publishing',
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
    sourceKey: text('source_key'),
    audioUrl: text('audio_url'),
    peaksUrl: text('peaks_url'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // NULLS NOT DISTINCT keeps unseasoned content idempotent while allowing the
    // same episode number in multiple seasons of one show.
    showSeasonNumberUnique: unique('episodes_show_season_number_unique')
      .on(t.showId, t.seasonId, t.number)
      .nullsNotDistinct(),
    statusIdx: index('episodes_status_idx').on(t.status),
  }),
);
