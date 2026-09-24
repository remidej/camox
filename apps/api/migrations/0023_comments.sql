CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` integer NOT NULL,
	`page_id` integer NOT NULL,
	`block_id` integer,
	`item_id` integer,
	`target` text,
	`message` text NOT NULL,
	`author_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`item_id`) REFERENCES `repeatable_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `comments_page_idx` ON `comments` (`page_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comments_environment_idx` ON `comments` (`environment_id`);--> statement-breakpoint
CREATE INDEX `comments_block_idx` ON `comments` (`block_id`);--> statement-breakpoint
CREATE INDEX `comments_item_idx` ON `comments` (`item_id`);