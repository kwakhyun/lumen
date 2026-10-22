import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const sites = sqliteTable('sites', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), name: text('name').notNull(), domain: text('domain').notNull(),
  description: text('description').notNull().default(''), industry: text('industry').notNull().default(''), language: text('language').notNull().default('English'), country: text('country').notNull().default('US'),
  mode: text('mode', { enum: ['live', 'demo'] }).notNull().default('live'), trackingKey: text('tracking_key').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [index('sites_owner_idx').on(t.ownerId), uniqueIndex('sites_tracking_idx').on(t.trackingKey)]);
export const prompts = sqliteTable('prompts', {
  id: text('id').primaryKey(), siteId: text('site_id').notNull().references(() => sites.id, {onDelete:'cascade'}), text: text('text').notNull(), topic: text('topic').notNull().default('General'),
  intent: text('intent', {enum:['informational','comparison','transactional']}).notNull().default('informational'), active: integer('active',{mode:'boolean'}).notNull().default(true), pinned: integer('pinned',{mode:'boolean'}).notNull().default(false), createdAt: text('created_at').notNull(),
}, t => [index('prompts_site_idx').on(t.siteId)]);
export const competitors = sqliteTable('competitors', {
  id: text('id').primaryKey(), siteId: text('site_id').notNull().references(() => sites.id, {onDelete:'cascade'}), name: text('name').notNull(), domain: text('domain').notNull(), createdAt: text('created_at').notNull(),
}, t => [index('competitors_site_idx').on(t.siteId), uniqueIndex('competitors_domain_idx').on(t.siteId,t.domain)]);
export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(), siteId: text('site_id').notNull().references(() => sites.id, {onDelete:'cascade'}), mode: text('mode',{enum:['live','demo']}).notNull(),
  status: text('status',{enum:['queued','running','completed','partial','failed']}).notNull().default('queued'), models: text('models').notNull(), total: integer('total').notNull(), completed: integer('completed').notNull().default(0), failed: integer('failed').notNull().default(0),
  leaseUntil: integer('lease_until').notNull().default(0), leaseToken: text('lease_token'), createdAt: text('created_at').notNull(), completedAt: text('completed_at'), error: text('error'),
}, t => [index('runs_site_idx').on(t.siteId,t.createdAt)]);
export const answers = sqliteTable('answers', {
  id: text('id').primaryKey(), siteId: text('site_id').notNull().references(() => sites.id, {onDelete:'cascade'}), runId: text('run_id').notNull().references(() => runs.id,{onDelete:'cascade'}), promptId: text('prompt_id').notNull(), promptText: text('prompt_text').notNull(),
  model: text('model').notNull(), provider: text('provider').notNull(), mode: text('mode',{enum:['live','demo']}).notNull(), status: text('status',{enum:['pending','processing','completed','failed']}).notNull().default('pending'),
  text: text('text').notNull().default(''), citations: text('citations').notNull().default('[]'), mentions: text('mentions').notNull().default('[]'), inputTokens: integer('input_tokens').notNull().default(0), outputTokens: integer('output_tokens').notNull().default(0),
  providerResponseId: text('provider_response_id'), error: text('error'), createdAt: text('created_at').notNull(), completedAt: text('completed_at'),
}, t=>[index('answers_site_idx').on(t.siteId,t.createdAt), index('answers_run_idx').on(t.runId), uniqueIndex('answer_run_prompt_model_idx').on(t.runId,t.promptId,t.model)]);
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(), siteId: text('site_id').notNull().references(() => sites.id,{onDelete:'cascade'}), kind: text('kind',{enum:['report','content']}).notNull(), title: text('title').notNull(), content: text('content').notNull(), format: text('format').notNull().default('article'), mode: text('mode',{enum:['live','demo']}).notNull(), createdAt: text('created_at').notNull(),
}, t=>[index('documents_site_idx').on(t.siteId,t.createdAt)]);
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(), siteId: text('site_id').notNull().references(() => sites.id,{onDelete:'cascade'}), title: text('title').notNull(), description: text('description').notNull().default(''), status: text('status',{enum:['todo','in_progress','done']}).notNull().default('todo'), priority: text('priority',{enum:['high','medium','low']}).notNull().default('medium'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t=>[index('tasks_site_idx').on(t.siteId)]);
export const quotas = sqliteTable('quotas', {id:text('id').primaryKey(),count:integer('count').notNull().default(0),expiresAt:integer('expires_at').notNull()});
export const traffic = sqliteTable('traffic', {
  id:text('id').primaryKey(),siteId:text('site_id').notNull().references(()=>sites.id,{onDelete:'cascade'}),day:text('day').notNull(),source:text('source').notNull(),path:text('path').notNull(),visits:integer('visits').notNull().default(1),
}, t=>[index('traffic_site_day_idx').on(t.siteId,t.day),uniqueIndex('traffic_bucket_idx').on(t.siteId,t.day,t.source,t.path)]);

export const personas = sqliteTable('personas', {id:text('id').primaryKey(),siteId:text('site_id').notNull().references(()=>sites.id,{onDelete:'cascade'}),name:text('name').notNull(),description:text('description').notNull().default(''),promptPrefix:text('prompt_prefix').notNull().default(''),createdAt:text('created_at').notNull()},t=>[index('personas_site_idx').on(t.siteId)]);

export * from './integrations-schema';

export * from './operations-schema';
export * from './eligibility-schema';
export * from './experiments-schema';
export * from './observability-schema';

export * from './impact-schema';

export * from "./impact-baseline-schema";

export * from "./impact-check-schema";

export * from './security-schema';
