import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Bounded runtime telemetry. Never store request bodies, headers, prompts, or credentials here. */
export const operationTicks = sqliteTable('operation_ticks', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id'),
  entryPoint: text('entry_point', { enum: ['mcp_owner', 'mcp_operator', 'service_bearer', 'run_now_api', 'internal'] }).notNull(),
  status: text('status', { enum: ['started', 'completed', 'failed', 'skipped'] }).notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  durationMs: integer('duration_ms'),
  queued: integer('queued').notNull().default(0),
  processed: integer('processed').notNull().default(0),
  completed: integer('completed').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  blocked: integer('blocked').notNull().default(0),
  skipped: integer('skipped', { mode: 'boolean' }).notNull().default(false),
  continuation: integer('continuation', { mode: 'boolean' }).notNull().default(false),
  errorCode: text('error_code'),
}, table => [index('operation_ticks_owner_started_idx').on(table.ownerId, table.startedAt), index('operation_ticks_started_idx').on(table.startedAt)]);
