CREATE TABLE `link_checks` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`url` text NOT NULL,
	`failure` text,
	`failures` integer NOT NULL,
	`checked_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `link_checks_url_idx` ON `link_checks` (`project_id`,`url`);