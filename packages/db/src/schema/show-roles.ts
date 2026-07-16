import { index, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { shows } from './shows';
import { users } from './users';

export const showRoleEnum = pgEnum('show_role', ['tl', 'tlc', 'ed', 'ts', 'qc']);

/** One functional fansub role per contributor and show. */
export const showRoleAssignments = pgTable(
  'show_role_assignments',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    showId: text('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    role: showRoleEnum('role').notNull(),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.showId] }),
    index('show_role_assignments_show_idx').on(table.showId, table.role),
  ],
);
