import { pgTable, text, uuid, integer, timestamp, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'anon',
  'editor',
  'translator',
  'reviewer',
  'admin',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    discordId: text('discord_id'),
    handle: text('handle').notNull(),
    email: text('email'),
    reputation: integer('reputation').notNull().default(0),
    role: userRoleEnum('role').notNull().default('editor'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    discordIdx: uniqueIndex('users_discord_id_idx').on(t.discordId),
    handleIdx: uniqueIndex('users_handle_idx').on(t.handle),
  }),
);
