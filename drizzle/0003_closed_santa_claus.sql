CREATE TABLE `improvement_experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`title` text NOT NULL,
	`hypothesis` text NOT NULL,
	`intervention` text NOT NULL,
	`metric` text NOT NULL,
	`target_delta` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`baseline_run_id` text NOT NULL,
	`followup_run_id` text,
	`baseline_snapshot` text NOT NULL,
	`followup_snapshot` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`baseline_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`followup_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `experiments_site_created_idx` ON `improvement_experiments` (`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `operation_ticks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`entry_point` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`duration_ms` integer,
	`queued` integer DEFAULT 0 NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`blocked` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT false NOT NULL,
	`continuation` integer DEFAULT false NOT NULL,
	`error_code` text
);
--> statement-breakpoint
CREATE INDEX `operation_ticks_owner_started_idx` ON `operation_ticks` (`owner_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `operation_ticks_started_idx` ON `operation_ticks` (`started_at`);