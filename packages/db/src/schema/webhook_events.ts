import { pgTable, text, uuid, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Idempotency log for inbound webhooks. The primary key IS the upstream
 * event identifier (e.g., RunPod's run_id, Lemon Squeezy's event_id) so a
 * replay is naturally caught by the unique constraint.
 *
 * Insert with ON CONFLICT DO NOTHING and check the returned row count:
 *   - empty result → duplicate → idempotent skip
 *   - one row     → first delivery → process
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    episodeId: uuid('episode_id'),
    stage: text('stage'),
    status: text('status'),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceReceivedIdx: index('webhook_events_source_received_idx').on(t.source, t.receivedAt),
    episodeIdx: index('webhook_events_episode_idx').on(t.episodeId),
  }),
);
