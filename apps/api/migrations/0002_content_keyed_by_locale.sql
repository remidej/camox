CREATE TABLE `locales` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`draft_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`base_version` integer,
	`deleted` integer DEFAULT false NOT NULL,
	`first_published_at` integer,
	`published_at` integer,
	`published_by` text,
	`project_id` integer NOT NULL,
	`tag` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `locales_live_id_idx` ON `locales` (`id`) WHERE "locales"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `locales_draft_id_idx` ON `locales` (`draft_id`,`id`) WHERE "locales"."draft_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `locales_live_tag_idx` ON `locales` (`project_id`,`tag`) WHERE "locales"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `locales_live_default_idx` ON `locales` (`project_id`) WHERE "locales"."draft_id" is null and "locales"."is_default" = 1;--> statement-breakpoint
DROP INDEX `pages_live_id_idx`;--> statement-breakpoint
DROP INDEX `pages_draft_id_idx`;--> statement-breakpoint
ALTER TABLE `pages` ADD `locale` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `pages_live_id_idx` ON `pages` (`id`,`locale`) WHERE "pages"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `pages_draft_id_idx` ON `pages` (`draft_id`,`id`,`locale`) WHERE "pages"."draft_id" is not null;--> statement-breakpoint
DROP INDEX `blocks_live_id_idx`;--> statement-breakpoint
DROP INDEX `blocks_draft_id_idx`;--> statement-breakpoint
ALTER TABLE `blocks` ADD `locale` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `blocks_live_id_idx` ON `blocks` (`id`,`locale`) WHERE "blocks"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `blocks_draft_id_idx` ON `blocks` (`draft_id`,`id`,`locale`) WHERE "blocks"."draft_id" is not null;--> statement-breakpoint
DROP INDEX `shared_contents_live_id_idx`;--> statement-breakpoint
DROP INDEX `shared_contents_draft_id_idx`;--> statement-breakpoint
ALTER TABLE `shared_contents` ADD `locale` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `shared_contents_live_id_idx` ON `shared_contents` (`id`,`locale`) WHERE "shared_contents"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `shared_contents_draft_id_idx` ON `shared_contents` (`draft_id`,`id`,`locale`) WHERE "shared_contents"."draft_id" is not null;--> statement-breakpoint
DROP INDEX `repeatable_items_live_id_idx`;--> statement-breakpoint
DROP INDEX `repeatable_items_draft_id_idx`;--> statement-breakpoint
ALTER TABLE `repeatable_items` ADD `locale` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `repeatable_items_live_id_idx` ON `repeatable_items` (`id`,`locale`) WHERE "repeatable_items"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `repeatable_items_draft_id_idx` ON `repeatable_items` (`draft_id`,`id`,`locale`) WHERE "repeatable_items"."draft_id" is not null;--> statement-breakpoint
DROP INDEX `collection_records_live_id_idx`;--> statement-breakpoint
DROP INDEX `collection_records_draft_id_idx`;--> statement-breakpoint
ALTER TABLE `collection_records` ADD `locale` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `collection_records_live_id_idx` ON `collection_records` (`id`,`locale`) WHERE "collection_records"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `collection_records_draft_id_idx` ON `collection_records` (`draft_id`,`id`,`locale`) WHERE "collection_records"."draft_id" is not null;