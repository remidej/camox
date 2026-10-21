CREATE TABLE `releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`commit` text NOT NULL,
	`camox_version` text,
	`status` text NOT NULL,
	`failed_step` text,
	`workflow_instance_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `releases_workflow_instance_idx` ON `releases` (`workflow_instance_id`);--> statement-breakpoint
CREATE INDEX `releases_project_idx` ON `releases` (`project_id`,`started_at`);