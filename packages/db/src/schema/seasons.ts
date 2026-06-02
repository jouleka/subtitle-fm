import { pgTable, text, integer, uuid, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { shows } from './shows';

export const seasons = pgTable(
  'seasons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    showId: text('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    showNumberIdx: uniqueIndex('seasons_show_number_idx').on(t.showId, t.number),
  }),
);
