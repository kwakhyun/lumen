CREATE TABLE `ai_usage_buckets` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_usage_expiry_idx` ON `ai_usage_buckets` (`expires_at`);--> statement-breakpoint
CREATE TABLE `ai_usage_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`operation` text NOT NULL,
	`units` integer NOT NULL,
	`claim_token` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_usage_owner_idx` ON `ai_usage_reservations` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ga4_connections` (
	`site_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`refresh_cipher` text,
	`access_cipher` text,
	`access_expires` integer DEFAULT 0 NOT NULL,
	`scopes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`property_id` text,
	`property_name` text,
	`report` text,
	`last_synced_at` text,
	`error` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ga4_owner_idx` ON `ga4_connections` (`owner_id`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`site_id` text NOT NULL,
	`verifier_cipher` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_state_expiry_idx` ON `oauth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `collection_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`frequency` text NOT NULL,
	`timezone` text NOT NULL,
	`hour` integer NOT NULL,
	`minute` integer NOT NULL,
	`weekdays` text DEFAULT '[]' NOT NULL,
	`models` text NOT NULL,
	`prompt_ids` text,
	`next_run_at` integer NOT NULL,
	`last_run_at` integer,
	`last_status` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `schedules_owner_site_idx` ON `collection_schedules` (`owner_id`,`site_id`);--> statement-breakpoint
CREATE INDEX `schedules_due_idx` ON `collection_schedules` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `operation_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`site_id` text NOT NULL,
	`execution_id` text,
	`dedupe_key` text NOT NULL,
	`severity` text NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`execution_id`) REFERENCES `scheduled_executions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_dedupe_idx` ON `operation_alerts` (`owner_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `alerts_owner_site_idx` ON `operation_alerts` (`owner_id`,`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `operation_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`site_id` text NOT NULL,
	`action` text NOT NULL,
	`subject_id` text,
	`summary` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_owner_site_idx` ON `operation_audit` (`owner_id`,`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `operation_heartbeats` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`last_started_at` text,
	`last_finished_at` text,
	`last_success_at` text,
	`last_error_code` text,
	`last_tick_id` text
);
--> statement-breakpoint
CREATE TABLE `scheduled_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`site_id` text NOT NULL,
	`schedule_id` text,
	`schedule_name` text NOT NULL,
	`scheduled_for` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`run_id` text,
	`configuration` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`schedule_id`) REFERENCES `collection_schedules`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `execution_occurrence_idx` ON `scheduled_executions` (`schedule_id`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `execution_owner_site_idx` ON `scheduled_executions` (`owner_id`,`site_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `execution_pending_idx` ON `scheduled_executions` (`status`,`next_attempt_at`,`lease_until`);