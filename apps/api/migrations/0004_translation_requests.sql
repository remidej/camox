CREATE TABLE `translation_requests` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`draft_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`locale` text NOT NULL,
	`requested_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `translation_requests_key_idx` ON `translation_requests` (`draft_id`,`entity`,`entity_id`,`locale`);--> statement-breakpoint
CREATE INDEX `translation_requests_project_idx` ON `translation_requests` (`project_id`);