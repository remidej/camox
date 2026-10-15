CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`teamId` text,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`inviterId` text NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inviterId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text,
	`logo` text,
	`metadata` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	`activeOrganizationId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`image` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE TABLE `ai_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_table` text NOT NULL,
	`entity_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_jobs_entity_idx` ON `ai_jobs` (`entity_table`,`entity_id`,`type`);--> statement-breakpoint
CREATE TABLE `environments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `environments_project_name_idx` ON `environments` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `environments_project_idx` ON `environments` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`deploy_token` text DEFAULT '' NOT NULL,
	`organization_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_idx` ON `projects` (`slug`);--> statement-breakpoint
CREATE INDEX `projects_organization_idx` ON `projects` (`organization_id`);--> statement-breakpoint
CREATE TABLE `layouts` (
	`project_id` integer NOT NULL,
	`environment_id` integer NOT NULL,
	`layout_id` text NOT NULL,
	`description` text,
	`kind` text DEFAULT 'curated' NOT NULL,
	`content_updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `environment_id`, `layout_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `layouts_environment_layout_idx` ON `layouts` (`environment_id`,`layout_id`);--> statement-breakpoint
CREATE TABLE `pages` (
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
	`environment_id` integer NOT NULL,
	`path_segment` text NOT NULL,
	`full_path` text NOT NULL,
	`parent_page_id` text,
	`layout_id` text NOT NULL,
	`nickname` text NOT NULL,
	`meta_title` text,
	`meta_description` text,
	`ai_seo_enabled` integer,
	`custom_og_image_blob_id` text,
	`custom_og_image_url` text,
	`content_updated_at` integer NOT NULL,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_live_id_idx` ON `pages` (`id`) WHERE "pages"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `pages_draft_id_idx` ON `pages` (`draft_id`,`id`) WHERE "pages"."draft_id" is not null;--> statement-breakpoint
CREATE INDEX `pages_full_path_idx` ON `pages` (`full_path`);--> statement-breakpoint
CREATE INDEX `pages_parent_idx` ON `pages` (`parent_page_id`);--> statement-breakpoint
CREATE INDEX `pages_project_idx` ON `pages` (`project_id`);--> statement-breakpoint
CREATE INDEX `pages_environment_full_path_idx` ON `pages` (`environment_id`,`full_path`);--> statement-breakpoint
CREATE TABLE `block_definitions` (
	`project_id` integer NOT NULL,
	`environment_id` integer NOT NULL,
	`block_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`content_schema` text NOT NULL,
	`settings_schema` text,
	`default_content` text,
	`default_settings` text,
	`layout_only` integer,
	`synced` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `environment_id`, `block_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `block_definitions_environment_block_idx` ON `block_definitions` (`environment_id`,`block_id`);--> statement-breakpoint
CREATE TABLE `blocks` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`draft_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`base_version` integer,
	`deleted` integer DEFAULT false NOT NULL,
	`first_published_at` integer,
	`published_at` integer,
	`published_by` text,
	`environment_id` integer NOT NULL,
	`page_id` text,
	`layout_id` text,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`settings` text,
	`slot` text,
	`summary` text DEFAULT '' NOT NULL,
	`position` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blocks_live_id_idx` ON `blocks` (`id`) WHERE "blocks"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `blocks_draft_id_idx` ON `blocks` (`draft_id`,`id`) WHERE "blocks"."draft_id" is not null;--> statement-breakpoint
CREATE INDEX `blocks_page_idx` ON `blocks` (`page_id`);--> statement-breakpoint
CREATE INDEX `blocks_layout_idx` ON `blocks` (`environment_id`,`layout_id`);--> statement-breakpoint
CREATE INDEX `blocks_type_idx` ON `blocks` (`type`);--> statement-breakpoint
CREATE TABLE `shared_contents` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`draft_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`base_version` integer,
	`deleted` integer DEFAULT false NOT NULL,
	`first_published_at` integer,
	`published_at` integer,
	`published_by` text,
	`environment_id` integer NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`settings` text,
	`summary` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_contents_live_id_idx` ON `shared_contents` (`id`) WHERE "shared_contents"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `shared_contents_draft_id_idx` ON `shared_contents` (`draft_id`,`id`) WHERE "shared_contents"."draft_id" is not null;--> statement-breakpoint
CREATE INDEX `shared_contents_definition_idx` ON `shared_contents` (`environment_id`,`type`);--> statement-breakpoint
CREATE TABLE `repeatable_items` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`draft_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`base_version` integer,
	`deleted` integer DEFAULT false NOT NULL,
	`first_published_at` integer,
	`published_at` integer,
	`published_by` text,
	`block_id` text,
	`environment_id` integer,
	`shared_content_type` text,
	`parent_item_id` text,
	`field_name` text NOT NULL,
	`content` text NOT NULL,
	`settings` text,
	`summary` text DEFAULT '' NOT NULL,
	`position` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "repeatable_items_one_root" CHECK(("repeatable_items"."block_id" is null) != ("repeatable_items"."shared_content_type" is null) and ("repeatable_items"."environment_id" is null) = ("repeatable_items"."shared_content_type" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repeatable_items_live_id_idx` ON `repeatable_items` (`id`) WHERE "repeatable_items"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `repeatable_items_draft_id_idx` ON `repeatable_items` (`draft_id`,`id`) WHERE "repeatable_items"."draft_id" is not null;--> statement-breakpoint
CREATE INDEX `repeatable_items_block_field_idx` ON `repeatable_items` (`block_id`,`field_name`);--> statement-breakpoint
CREATE INDEX `repeatable_items_block_idx` ON `repeatable_items` (`block_id`);--> statement-breakpoint
CREATE INDEX `repeatable_items_parent_idx` ON `repeatable_items` (`parent_item_id`);--> statement-breakpoint
CREATE INDEX `repeatable_items_shared_content_idx` ON `repeatable_items` (`environment_id`,`shared_content_type`);--> statement-breakpoint
CREATE TABLE `files` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`draft_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`base_version` integer,
	`deleted` integer DEFAULT false NOT NULL,
	`first_published_at` integer,
	`published_at` integer,
	`published_by` text,
	`project_id` integer,
	`environment_id` integer NOT NULL,
	`url` text NOT NULL,
	`alt` text DEFAULT '' NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`optimized_size` integer,
	`blob_id` text NOT NULL,
	`path` text NOT NULL,
	`ai_metadata_enabled` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_live_id_idx` ON `files` (`id`) WHERE "files"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `files_draft_id_idx` ON `files` (`draft_id`,`id`) WHERE "files"."draft_id" is not null;--> statement-breakpoint
CREATE INDEX `files_blob_id_idx` ON `files` (`blob_id`);--> statement-breakpoint
CREATE INDEX `files_project_idx` ON `files` (`project_id`);--> statement-breakpoint
CREATE INDEX `files_environment_idx` ON `files` (`environment_id`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` integer NOT NULL,
	`draft_id` text,
	`addressed_in_draft_id` text,
	`page_id` text NOT NULL,
	`block_id` text,
	`item_id` text,
	`target` text,
	`message` text NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`author_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`addressed_in_draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `comments_page_idx` ON `comments` (`page_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comments_environment_idx` ON `comments` (`environment_id`);--> statement-breakpoint
CREATE INDEX `comments_block_idx` ON `comments` (`block_id`);--> statement-breakpoint
CREATE INDEX `comments_item_idx` ON `comments` (`item_id`);--> statement-breakpoint
CREATE INDEX `comments_draft_idx` ON `comments` (`draft_id`);--> statement-breakpoint
CREATE INDEX `comments_addressed_in_draft_idx` ON `comments` (`addressed_in_draft_id`);--> statement-breakpoint
CREATE TABLE `collection_definitions` (
	`project_id` integer NOT NULL,
	`environment_id` integer NOT NULL,
	`collection_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`label` text NOT NULL,
	`content_schema` text NOT NULL,
	PRIMARY KEY(`project_id`, `environment_id`, `collection_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `collection_records` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`draft_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`base_version` integer,
	`deleted` integer DEFAULT false NOT NULL,
	`first_published_at` integer,
	`published_at` integer,
	`published_by` text,
	`environment_id` integer NOT NULL,
	`collection_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_records_live_id_idx` ON `collection_records` (`id`) WHERE "collection_records"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `collection_records_draft_id_idx` ON `collection_records` (`draft_id`,`id`) WHERE "collection_records"."draft_id" is not null;--> statement-breakpoint
CREATE INDEX `collection_records_collection` ON `collection_records` (`environment_id`,`collection_id`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `drafts_project_idx` ON `drafts` (`project_id`);--> statement-breakpoint
CREATE TABLE `ended_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`outcome` text NOT NULL,
	`ended_by` text NOT NULL,
	`ended_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ended_drafts_project_idx` ON `ended_drafts` (`project_id`);