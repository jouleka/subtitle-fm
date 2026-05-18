import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const shows = pgTable(
  'shows',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    malId: text('mal_id'),
    anilistId: text('anilist_id'),
    kitsuId: text('kitsu_id'),
    coverUrl: text('cover_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex('shows_slug_idx').on(t.slug),
  }),
);
