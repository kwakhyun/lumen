CREATE TABLE `answers` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`run_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	`prompt_text` text NOT NULL,
	`model` text NOT NULL,
	`provider` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`citations` text DEFAULT '[]' NOT NULL,
	`mentions` text DEFAULT '[]' NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`provider_response_id` text,
	`error` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `answers_site_idx` ON `answers` (`site_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `answers_run_idx` ON `answers` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `answer_run_prompt_model_idx` ON `answers` (`run_id`,`prompt_id`,`model`);--> statement-breakpoint
CREATE TABLE `competitors` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `competitors_site_idx` ON `competitors` (`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `competitors_domain_idx` ON `competitors` (`site_id`,`domain`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`format` text DEFAULT 'article' NOT NULL,
	`mode` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `documents_site_idx` ON `documents` (`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `personas` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`prompt_prefix` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `personas_site_idx` ON `personas` (`site_id`);--> statement-breakpoint
CREATE TABLE `prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`text` text NOT NULL,
	`topic` text DEFAULT 'General' NOT NULL,
	`intent` text DEFAULT 'informational' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prompts_site_idx` ON `prompts` (`site_id`);--> statement-breakpoint
CREATE TABLE `quotas` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`models` text NOT NULL,
	`total` integer NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	`error` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_site_idx` ON `runs` (`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`industry` text DEFAULT '' NOT NULL,
	`language` text DEFAULT 'English' NOT NULL,
	`country` text DEFAULT 'US' NOT NULL,
	`mode` text DEFAULT 'live' NOT NULL,
	`tracking_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sites_owner_idx` ON `sites` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sites_tracking_idx` ON `sites` (`tracking_key`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tasks_site_idx` ON `tasks` (`site_id`);--> statement-breakpoint
CREATE TABLE `traffic` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`day` text NOT NULL,
	`source` text NOT NULL,
	`path` text NOT NULL,
	`visits` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `traffic_site_day_idx` ON `traffic` (`site_id`,`day`);--> statement-breakpoint
CREATE UNIQUE INDEX `traffic_bucket_idx` ON `traffic` (`site_id`,`day`,`source`,`path`);