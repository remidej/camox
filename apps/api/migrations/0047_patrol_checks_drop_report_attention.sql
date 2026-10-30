CREATE TABLE `patrol_checks` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`draft_id` text,
	`patroller` text NOT NULL,
	`checked_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patrol_checks_live_idx` ON `patrol_checks` (`project_id`,`patroller`) WHERE "patrol_checks"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `patrol_checks_draft_idx` ON `patrol_checks` (`draft_id`,`patroller`) WHERE "patrol_checks"."draft_id" is not null;--> statement-breakpoint
ALTER TABLE `reports` DROP COLUMN `attention`;