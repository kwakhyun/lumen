import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { runs, sites } from './schema';

/** Passive research records: creating or changing an experiment never schedules collection. */
export const improvementExperiments = sqliteTable('improvement_experiments', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  hypothesis: text('hypothesis').notNull(),
  intervention: text('intervention').notNull(),
  metric: text('metric', { enum: ['mentionRate', 'citationRate'] }).notNull(),
  targetDelta: integer('target_delta').notNull(),
  status: text('status', { enum: ['draft', 'observing', 'reviewed'] }).notNull().default('draft'),
  baselineRunId: text('baseline_run_id').notNull().references(() => runs.id),
  followupRunId: text('followup_run_id').references(() => runs.id),
  baselineSnapshot: text('baseline_snapshot').notNull(),
  followupSnapshot: text('followup_snapshot'),
  notes: text('notes').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [index('experiments_site_created_idx').on(table.siteId, table.createdAt)]);
