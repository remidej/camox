CREATE TABLE `reports` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`draft_id` text,
	`patroller` text NOT NULL,
	`key` text NOT NULL,
	`summary` text NOT NULL,
	`outcome` text NOT NULL,
	`attention` text DEFAULT 'none' NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_live_idx` ON `reports` (`project_id`,`patroller`,`key`) WHERE "reports"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `reports_draft_idx` ON `reports` (`draft_id`,`patroller`,`key`) WHERE "reports"."draft_id" is not null;--> statement-breakpoint
CREATE INDEX `reports_project_idx` ON `reports` (`project_id`);