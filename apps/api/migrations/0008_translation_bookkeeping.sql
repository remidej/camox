CREATE TABLE `translation_bookkeeping` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`draft_id` text,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`locale` text NOT NULL,
	`source` text NOT NULL,
	`output` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `translation_bookkeeping_live_idx` ON `translation_bookkeeping` (`entity`,`entity_id`,`locale`) WHERE "translation_bookkeeping"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `translation_bookkeeping_draft_idx` ON `translation_bookkeeping` (`draft_id`,`entity`,`entity_id`,`locale`) WHERE "translation_bookkeeping"."draft_id" is not null;--> statement-breakpoint
CREATE INDEX `translation_bookkeeping_project_idx` ON `translation_bookkeeping` (`project_id`);