CREATE TABLE `impact_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`study_id` text NOT NULL,
	`arm` text NOT NULL,
	`phase` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`digest` text NOT NULL,
	`voided_at` text,
	`void_reason` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`study_id`) REFERENCES `impact_studies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `impact_outcomes_site_idx` ON `impact_outcomes` (`site_id`,`study_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `impact_outcomes_active_idx` ON `impact_outcomes` (`study_id`,`arm`,`phase`) WHERE "impact_outcomes"."voided_at" IS NULL;--> statement-breakpoint
CREATE TABLE `impact_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`study_id` text NOT NULL,
	`phase` text NOT NULL,
	`query_id` text NOT NULL,
	`repetition` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`digest` text NOT NULL,
	`voided_at` text,
	`void_reason` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`study_id`) REFERENCES `impact_studies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `impact_searches_site_idx` ON `impact_searches` (`site_id`,`study_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `impact_searches_active_idx` ON `impact_searches` (`study_id`,`phase`,`query_id`,`repetition`) WHERE "impact_searches"."voided_at" IS NULL;--> statement-breakpoint
CREATE TABLE `impact_studies` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`plan` text NOT NULL,
	`brand` text NOT NULL,
	`metric_version` text NOT NULL,
	`created_at` text NOT NULL,
	`digest` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `impact_studies_site_idx` ON `impact_studies` (`site_id`,`created_at`);