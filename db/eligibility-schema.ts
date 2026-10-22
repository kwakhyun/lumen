import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const aiEligibility = sqliteTable('ai_eligibility', {
  ownerId: text('owner_id').primaryKey(),
  version: text('version').notNull(),
  acceptedAt: text('accepted_at').notNull(),
});
