CREATE TABLE `security_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`evidence` text NOT NULL,
	`digest` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `security_checks_site_created_idx` ON `security_checks` (`site_id`,`created_at`);