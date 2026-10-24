CREATE TABLE `revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`commit` text NOT NULL,
	`tree` text NOT NULL,
	`parents` text NOT NULL,
	`left_by` text NOT NULL,
	`thread_id` text,
	`run_id` text,
	`build_status` text NOT NULL,
	`type_check_status` text NOT NULL,
	`archive_key` text,
	`camox_version` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revisions_draft_tree_idx` ON `revisions` (`draft_id`,`tree`);--> statement-breakpoint
CREATE INDEX `revisions_draft_idx` ON `revisions` (`draft_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `drafts` ADD `head_revision_id` text;