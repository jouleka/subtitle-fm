import {
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    userIdx: index('api_keys_user_id_idx').on(t.userId),
    hashIdx: uniqueIndex('api_keys_key_hash_idx').on(t.keyHash),
  }),
);

export const apiUsageDaily = pgTable(
  'api_usage_daily',
  {
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    requestCount: integer('request_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.apiKeyId, t.day] }),
    dayIdx: index('api_usage_daily_day_idx').on(t.day),
  }),
);
