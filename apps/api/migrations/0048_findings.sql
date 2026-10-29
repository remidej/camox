CREATE TABLE `finding_dismissals` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`patroller` text NOT NULL,
	`identity` text NOT NULL,
	`about` text NOT NULL,
	`dismissed_by` text NOT NULL,
	`dismissed_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finding_dismissals_identity_idx` ON `finding_dismissals` (`project_id`,`patroller`,`identity`);--> statement-breakpoint
CREATE TABLE `findings` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`draft_id` text,
	`patroller` text NOT NULL,
	`key` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`locale` text NOT NULL,
	`field` text NOT NULL,
	`identity` text NOT NULL,
	`about` text NOT NULL,
	`fix` text,
	`raised_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `findings_live_idx` ON `findings` (`project_id`,`patroller`,`key`) WHERE "findings"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `findings_draft_idx` ON `findings` (`draft_id`,`patroller`,`key`) WHERE "findings"."draft_id" is not null;--> statement-breakpoint
CREATE INDEX `findings_identity_idx` ON `findings` (`project_id`,`patroller`,`identity`);--> statement-breakpoint
ALTER TABLE `patrol_checks` ADD `fingerprint` text;