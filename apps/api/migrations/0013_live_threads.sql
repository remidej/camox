CREATE TABLE `live_threads` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_threads_owner_idx` ON `live_threads` (`project_id`,`user_id`);