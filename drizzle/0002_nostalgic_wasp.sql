CREATE TABLE `ai_eligibility` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`accepted_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `collection_schedules` ADD `ends_at` integer;