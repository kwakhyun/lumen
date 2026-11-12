import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sites } from './schema';

/**
 * One finished or failed agent run. Proposed follow-ups stay proposals until the owner accepts them.
 * Not re-exported from schema.ts: the table is created by migrations/agents, outside the
 * checksum-pinned drizzle/ migrations that workspace backups depend on.
 */
export const agentRuns = sqliteTable('agent_runs', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id').notNull(),
  agentId: text('agent_id').notNull(),
  title: text('title').notNull(),
  status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull().default('running'),
  mode: text('mode', { enum: ['live', 'demo'] }).notNull(),
  input: text('input').notNull().default('{}'),
  scope: text('scope').notNull().default('{}'),
  steps: text('steps').notNull().default('[]'),
  summary: text('summary').notNull().default(''),
  report: text('report').notNull().default(''),
  proposals: text('proposals').notNull().default('[]'),
  model: text('model'),
  units: integer('units').notNull().default(0),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
}, table => [index('agent_runs_site_created_idx').on(table.siteId, table.createdAt)]);
