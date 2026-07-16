import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { episodes, episodeStatusEnum } from './episodes';
import { users } from './users';

export const takedownStatusEnum = pgEnum('takedown_status', [
  'submitted',
  'under_review',
  'removed',
  'rejected',
  'counter_submitted',
  'court_action',
  'restored',
]);

export const takedownNotices = pgTable(
  'takedown_notices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'restrict' }),
    status: takedownStatusEnum('status').notNull().default('submitted'),
    claimantName: text('claimant_name').notNull(),
    claimantEmail: text('claimant_email').notNull(),
    claimantAddress: text('claimant_address').notNull(),
    claimantPhone: text('claimant_phone').notNull(),
    copyrightedWork: text('copyrighted_work').notNull(),
    materialUrl: text('material_url').notNull(),
    signature: text('signature').notNull(),
    goodFaithConfirmed: boolean('good_faith_confirmed').notNull(),
    accuracyConfirmed: boolean('accuracy_confirmed').notNull(),
    originalEpisodeStatus: episodeStatusEnum('original_episode_status'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNotes: text('review_notes'),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    episodeIdx: index('takedown_notices_episode_id_idx').on(t.episodeId),
    statusIdx: index('takedown_notices_status_idx').on(t.status),
  }),
);

export const counterNotices = pgTable(
  'counter_notices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    takedownNoticeId: uuid('takedown_notice_id')
      .notNull()
      .references(() => takedownNotices.id, { onDelete: 'cascade' }),
    submitterName: text('submitter_name').notNull(),
    submitterEmail: text('submitter_email').notNull(),
    submitterAddress: text('submitter_address').notNull(),
    submitterPhone: text('submitter_phone').notNull(),
    removedMaterialUrl: text('removed_material_url').notNull(),
    signature: text('signature').notNull(),
    mistakeConfirmed: boolean('mistake_confirmed').notNull(),
    jurisdictionConfirmed: boolean('jurisdiction_confirmed').notNull(),
    serviceConfirmed: boolean('service_confirmed').notNull(),
    restoreEligibleAt: timestamp('restore_eligible_at', { withTimezone: true }).notNull(),
    restoreDeadlineAt: timestamp('restore_deadline_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    noticeIdx: uniqueIndex('counter_notices_takedown_notice_id_idx').on(t.takedownNoticeId),
    eligibleIdx: index('counter_notices_restore_eligible_at_idx').on(t.restoreEligibleAt),
  }),
);
