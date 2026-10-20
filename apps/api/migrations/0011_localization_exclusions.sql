CREATE TABLE `localization_exclusions` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`draft_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`base_version` integer,
	`deleted` integer DEFAULT false NOT NULL,
	`first_published_at` integer,
	`published_at` integer,
	`published_by` text,
	`locale` text NOT NULL,
	`project_id` integer NOT NULL,
	`entity` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `localization_exclusions_live_id_idx` ON `localization_exclusions` (`id`,`locale`) WHERE "localization_exclusions"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `localization_exclusions_draft_id_idx` ON `localization_exclusions` (`draft_id`,`id`,`locale`) WHERE "localization_exclusions"."draft_id" is not null;--> statement-breakpoint
CREATE INDEX `localization_exclusions_project_idx` ON `localization_exclusions` (`project_id`);