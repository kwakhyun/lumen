import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sites } from './schema';
/** Passive manual evidence only. No scheduling or provider invocation. */
export const impactStudies = sqliteTable('impact_studies', {
  id: text('id').primaryKey(), siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }), plan: text('plan').notNull(), brand: text('brand').notNull(), metricVersion: text('metric_version').notNull(), createdAt: text('created_at').notNull(), digest: text('digest').notNull(),
}, table => [index('impact_studies_site_idx').on(table.siteId, table.createdAt)]);
export const impactSearches = sqliteTable('impact_searches', {
  id: text('id').primaryKey(), siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }), studyId: text('study_id').notNull().references(() => impactStudies.id, { onDelete: 'cascade' }), phase: text('phase', { enum: ['before', 'after'] }).notNull(), queryId: text('query_id').notNull(), repetition: integer('repetition').notNull(), payload: text('payload').notNull(), createdAt: text('created_at').notNull(), digest: text('digest').notNull(), voidedAt: text('voided_at'), voidReason: text('void_reason'),
}, table => [index('impact_searches_site_idx').on(table.siteId, table.studyId), uniqueIndex('impact_searches_active_idx').on(table.studyId, table.phase, table.queryId, table.repetition).where(sql`${table.voidedAt} IS NULL`)]);
export const impactOutcomes = sqliteTable('impact_outcomes', {
  id: text('id').primaryKey(), siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }), studyId: text('study_id').notNull().references(() => impactStudies.id, { onDelete: 'cascade' }), arm: text('arm', { enum: ['treatment', 'control'] }).notNull(), phase: text('phase', { enum: ['before', 'after'] }).notNull(), payload: text('payload').notNull(), createdAt: text('created_at').notNull(), digest: text('digest').notNull(), voidedAt: text('voided_at'), voidReason: text('void_reason'),
}, table => [index('impact_outcomes_site_idx').on(table.siteId, table.studyId), uniqueIndex('impact_outcomes_active_idx').on(table.studyId, table.arm, table.phase).where(sql`${table.voidedAt} IS NULL`)]);
