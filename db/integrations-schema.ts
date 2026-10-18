import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sites } from './schema';

export const aiUsageBuckets = sqliteTable('ai_usage_buckets', { id: text('id').primaryKey(), count: integer('count').notNull().default(0), expiresAt: integer('expires_at').notNull() }, t => [index('ai_usage_expiry_idx').on(t.expiresAt)]);
export const aiUsageReservations = sqliteTable('ai_usage_reservations', { id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), operation: text('operation').notNull(), units: integer('units').notNull(), claimToken: text('claim_token').notNull(), createdAt: text('created_at').notNull() }, t => [index('ai_usage_owner_idx').on(t.ownerId, t.createdAt)]);
export const ga4Connections = sqliteTable('ga4_connections', {
  siteId: text('site_id').primaryKey().references(() => sites.id, { onDelete: 'cascade' }), ownerId: text('owner_id').notNull(),
  refreshCipher: text('refresh_cipher'), accessCipher: text('access_cipher'), accessExpires: integer('access_expires').notNull().default(0), scopes: text('scopes').notNull().default(''),
  status: text('status').notNull().default('disconnected'), propertyId: text('property_id'), propertyName: text('property_name'), report: text('report'),
  lastSyncedAt: text('last_synced_at'), error: text('error'), revision: integer('revision').notNull().default(0),
  leaseToken: text('lease_token'), leaseUntil: integer('lease_until').notNull().default(0), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [index('ga4_owner_idx').on(t.ownerId)]);
export const oauthStates = sqliteTable('oauth_states', {
  stateHash: text('state_hash').primaryKey(), ownerId: text('owner_id').notNull(), siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  verifierCipher: text('verifier_cipher').notNull(), redirectUri: text('redirect_uri').notNull(), expiresAt: integer('expires_at').notNull(),
}, t => [index('oauth_state_expiry_idx').on(t.expiresAt)]);
