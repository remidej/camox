CREATE TABLE `proofreading_requests` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`draft_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`locale` text NOT NULL,
	`requested_at` integer NOT NULL,
	`started_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proofreading_requests_key_idx` ON `proofreading_requests` (`draft_id`,`entity`,`entity_id`,`locale`);--> statement-breakpoint
CREATE INDEX `proofreading_requests_project_idx` ON `proofreading_requests` (`project_id`);