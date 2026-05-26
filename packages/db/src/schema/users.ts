import { pgTable, text, uuid, integer, timestamp, boolean, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';

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
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    reputation: integer('reputation').notNull().default(0),
    role: userRoleEnum('role').notNull().default('editor'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    discordIdx: uniqueIndex('users_discord_id_idx').on(t.discordId),
    handleIdx: uniqueIndex('users_handle_idx').on(t.handle),
    emailIdx: uniqueIndex('users_email_idx').on(t.email),
  }),
);
