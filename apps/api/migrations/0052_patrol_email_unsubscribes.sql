CREATE TABLE `patrol_email_unsubscribes` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patrol_email_unsubscribes_member_idx` ON `patrol_email_unsubscribes` (`project_id`,`user_id`);