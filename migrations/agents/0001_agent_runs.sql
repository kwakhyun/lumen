-- Agent run history. Kept outside drizzle/ so the workspace backup manifest, which pins
-- those migrations by checksum, is unchanged: agent runs are not part of a backup.
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`mode` text NOT NULL,
	`input` text DEFAULT '{}' NOT NULL,
	`scope` text DEFAULT '{}' NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`report` text DEFAULT '' NOT NULL,
	`proposals` text DEFAULT '[]' NOT NULL,
	`model` text,
	`units` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `agent_runs_site_created_idx` ON `agent_runs` (`site_id`,`created_at`);
