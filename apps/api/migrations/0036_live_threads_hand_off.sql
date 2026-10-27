ALTER TABLE `drafts` ADD `live_thread_id` text;--> statement-breakpoint
ALTER TABLE `live_threads` DROP COLUMN `continued_in`;