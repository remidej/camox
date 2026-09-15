ALTER TABLE `block_definitions` ADD `synced` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `block_definitions` ADD `synced_published_data` text;--> statement-breakpoint
ALTER TABLE `repeatable_items` ADD `sync_key` text;