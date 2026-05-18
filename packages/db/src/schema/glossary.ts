import { pgTable, text, uuid, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { shows } from './shows';

export const glossaryKindEnum = pgEnum('glossary_kind', [
  'name',
  'place',
  'term',
  'attack',
  'honorific',
]);

export const glossaryTerms = pgTable(
  'glossary_terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    showId: text('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    sourceText: text('source_text').notNull(),
    targetText: text('target_text').notNull(),
    kind: glossaryKindEnum('kind').notNull().default('term'),
    notes: text('notes'),
  },
  (t) => ({
    showSourceIdx: uniqueIndex('glossary_show_source_idx').on(t.showId, t.sourceText),
  }),
);
