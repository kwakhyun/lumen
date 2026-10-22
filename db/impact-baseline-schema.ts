import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sites } from './schema';
import { impactStudies } from './impact-schema';
export const impactBaselines = sqliteTable('impact_baselines', {
  id: text('id').primaryKey(), siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }), studyId: text('study_id').notNull().references(() => impactStudies.id, { onDelete: 'cascade' }),
  queryKey: text('query_key').notNull(), payload: text('payload').notNull(), createdAt: text('created_at').notNull(), digest: text('digest').notNull(),
}, table => [index('impact_baselines_site_idx').on(table.siteId, table.studyId, table.createdAt), index('impact_baselines_query_idx').on(table.siteId, table.studyId, table.queryKey, table.createdAt)]);
