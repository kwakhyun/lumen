CREATE TABLE `impact_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`study_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`digest` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`study_id`) REFERENCES `impact_studies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `impact_checks_site_idx` ON `impact_checks` (`site_id`,`study_id`,`created_at`);