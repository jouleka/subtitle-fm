import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lemonSubscriptionId: text('lemon_subscription_id').notNull(),
    lemonCustomerId: text('lemon_customer_id').notNull(),
    lemonVariantId: text('lemon_variant_id').notNull(),
    status: text('status').notNull(),
    renewsAt: timestamp('renews_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    testMode: boolean('test_mode').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: uniqueIndex('subscriptions_user_id_idx').on(t.userId),
    externalIdx: uniqueIndex('subscriptions_lemon_subscription_id_idx').on(t.lemonSubscriptionId),
    statusIdx: index('subscriptions_status_idx').on(t.status),
  }),
);
