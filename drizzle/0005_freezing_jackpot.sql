CREATE TABLE `impact_baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`study_id` text NOT NULL,
	`query_key` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`digest` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`study_id`) REFERENCES `impact_studies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `impact_baselines_site_idx` ON `impact_baselines` (`site_id`,`study_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `impact_baselines_query_idx` ON `impact_baselines` (`site_id`,`study_id`,`query_key`,`created_at`);