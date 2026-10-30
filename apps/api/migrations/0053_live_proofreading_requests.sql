PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_proofreading_requests` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`draft_id` text,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`locale` text NOT NULL,
	`requested_at` integer NOT NULL,
	`started_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_proofreading_requests`("row_id", "project_id", "draft_id", "entity", "entity_id", "locale", "requested_at", "started_at") SELECT "row_id", "project_id", "draft_id", "entity", "entity_id", "locale", "requested_at", "started_at" FROM `proofreading_requests`;--> statement-breakpoint
DROP TABLE `proofreading_requests`;--> statement-breakpoint
ALTER TABLE `__new_proofreading_requests` RENAME TO `proofreading_requests`;--> statement-breakpoint
PRAGMA defer_foreign_keys = off;--> statement-breakpoint
CREATE UNIQUE INDEX `proofreading_requests_key_idx` ON `proofreading_requests` (`draft_id`,`entity`,`entity_id`,`locale`) WHERE "proofreading_requests"."draft_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `proofreading_requests_live_idx` ON `proofreading_requests` (`project_id`,`entity`,`entity_id`,`locale`) WHERE "proofreading_requests"."draft_id" is null;--> statement-breakpoint
CREATE INDEX `proofreading_requests_project_idx` ON `proofreading_requests` (`project_id`);