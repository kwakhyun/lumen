import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import { sites } from './schema';

/** Immutable, explicitly imported observations. Findings are recomputed from evidence. */
export const securityChecks = sqliteTable('security_checks', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  evidence: text('evidence').notNull(),
  digest: text('digest').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [index('security_checks_site_created_idx').on(t.siteId, t.createdAt)]);
