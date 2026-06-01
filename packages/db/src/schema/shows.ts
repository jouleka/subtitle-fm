import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const shows = pgTable(
  'shows',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    imdbId: text('imdb_id'),
    malId: text('mal_id'),
    anilistId: text('anilist_id'),
    kitsuId: text('kitsu_id'),
    coverUrl: text('cover_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex('shows_slug_idx').on(t.slug),
    imdbIdIdx: uniqueIndex('shows_imdb_id_idx').on(t.imdbId),
    malIdIdx: uniqueIndex('shows_mal_id_idx').on(t.malId),
    anilistIdIdx: uniqueIndex('shows_anilist_id_idx').on(t.anilistId),
    kitsuIdIdx: uniqueIndex('shows_kitsu_id_idx').on(t.kitsuId),
  }),
);
