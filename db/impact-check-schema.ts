import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sites } from './schema';
import { impactStudies } from './impact-schema';
/** Append-only deployment spot checks, separate from frozen study outcomes. */
export const impactChecks = sqliteTable('impact_checks', {
  id: text('id').primaryKey(), siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }), studyId: text('study_id').notNull().references(() => impactStudies.id, { onDelete: 'cascade' }),
  payload: text('payload').notNull(), createdAt: text('created_at').notNull(), digest: text('digest').notNull(),
}, table => [index('impact_checks_site_idx').on(table.siteId, table.studyId, table.createdAt)]);
