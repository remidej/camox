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
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`environment_id` integer NOT NULL,
	`layout_id` text NOT NULL,
	`description` text,
	`kind` text DEFAULT 'curated' NOT NULL,
	`live_published_checkpoint_id` integer,
	`content_updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `layouts_project_idx` ON `layouts` (`project_id`);--> statement-breakpoint
CREATE INDEX `layouts_project_layout_idx` ON `layouts` (`project_id`,`layout_id`);--> statement-breakpoint
CREATE INDEX `layouts_environment_layout_idx` ON `layouts` (`environment_id`,`layout_id`);--> statement-breakpoint
CREATE TABLE `layout_checkpoints` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`layout_id` integer NOT NULL,
	`kind` text NOT NULL,
	`label` text,
	`snapshot` text NOT NULL,
	`schema_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	FOREIGN KEY (`layout_id`) REFERENCES `layouts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `layout_checkpoints_layout_created_idx` ON `layout_checkpoints` (`layout_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`environment_id` integer NOT NULL,
	`path_segment` text NOT NULL,
	`full_path` text NOT NULL,
	`parent_page_id` integer,
	`layout_id` integer NOT NULL,
	`nickname` text NOT NULL,
	`meta_title` text,
	`meta_description` text,
	`ai_seo_enabled` integer,
	`custom_og_image_blob_id` text,
	`custom_og_image_url` text,
	`live_published_checkpoint_id` integer,
	`content_updated_at` integer NOT NULL,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`layout_id`) REFERENCES `layouts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pages_full_path_idx` ON `pages` (`full_path`);--> statement-breakpoint
CREATE INDEX `pages_parent_idx` ON `pages` (`parent_page_id`);--> statement-breakpoint
CREATE INDEX `pages_project_idx` ON `pages` (`project_id`);--> statement-breakpoint
CREATE INDEX `pages_environment_full_path_idx` ON `pages` (`environment_id`,`full_path`);--> statement-breakpoint
CREATE TABLE `page_checkpoints` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`page_id` integer NOT NULL,
	`kind` text NOT NULL,
	`label` text,
	`snapshot` text NOT NULL,
	`schema_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `page_checkpoints_page_created_idx` ON `page_checkpoints` (`page_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `block_definitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
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
	`synced_published_data` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `block_definitions_project_idx` ON `block_definitions` (`project_id`);--> statement-breakpoint
CREATE INDEX `block_definitions_project_block_idx` ON `block_definitions` (`project_id`,`block_id`);--> statement-breakpoint
CREATE INDEX `block_definitions_environment_block_idx` ON `block_definitions` (`environment_id`,`block_id`);--> statement-breakpoint
CREATE TABLE `blocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`page_id` integer,
	`layout_id` integer,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`settings` text,
	`slot` text,
	`summary` text DEFAULT '' NOT NULL,
	`position` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`layout_id`) REFERENCES `layouts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blocks_page_idx` ON `blocks` (`page_id`);--> statement-breakpoint
CREATE INDEX `blocks_layout_idx` ON `blocks` (`layout_id`);--> statement-breakpoint
CREATE INDEX `blocks_type_idx` ON `blocks` (`type`);--> statement-breakpoint
CREATE TABLE `repeatable_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`block_id` integer NOT NULL,
	`parent_item_id` integer,
	`sync_key` text,
	`field_name` text NOT NULL,
	`content` text NOT NULL,
	`settings` text,
	`summary` text DEFAULT '' NOT NULL,
	`position` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_item_id`) REFERENCES `repeatable_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `repeatable_items_block_field_idx` ON `repeatable_items` (`block_id`,`field_name`);--> statement-breakpoint
CREATE INDEX `repeatable_items_block_idx` ON `repeatable_items` (`block_id`);--> statement-breakpoint
CREATE INDEX `repeatable_items_parent_idx` ON `repeatable_items` (`parent_item_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
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
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `files_blob_id_idx` ON `files` (`blob_id`);--> statement-breakpoint
CREATE INDEX `files_project_idx` ON `files` (`project_id`);--> statement-breakpoint
CREATE INDEX `files_environment_idx` ON `files` (`environment_id`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` integer NOT NULL,
	`page_id` integer NOT NULL,
	`block_id` integer,
	`item_id` integer,
	`target` text,
	`message` text NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
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
CREATE INDEX `comments_item_idx` ON `comments` (`item_id`);--> statement-breakpoint
CREATE TABLE `collection_definitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`environment_id` integer NOT NULL,
	`collection_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`label` text NOT NULL,
	`content_schema` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_definition_scope` ON `collection_definitions` (`project_id`,`environment_id`,`collection_id`);--> statement-breakpoint
CREATE TABLE `collection_records` (
	`id` text PRIMARY KEY NOT NULL,
	`definition_id` integer NOT NULL,
	`draft` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`published_revision_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`definition_id`) REFERENCES `collection_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`published_revision_id`) REFERENCES `collection_revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `collection_records_definition` ON `collection_records` (`definition_id`);--> statement-breakpoint
CREATE TABLE `collection_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`definition` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `collection_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `collection_revisions_record` ON `collection_revisions` (`record_id`);
--> statement-breakpoint
-- Hand-written: the Drizzle schema can't express views or triggers.
-- Keep this section when regenerating the baseline (see CONTRIBUTORS.md).
--
-- Collection history is append-only. A pointer may only select this record's publication.
CREATE TRIGGER collection_revisions_immutable BEFORE UPDATE ON collection_revisions
BEGIN SELECT RAISE(ABORT, 'Collection revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER collection_published_revision_owner BEFORE UPDATE OF published_revision_id ON collection_records
WHEN NEW.published_revision_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM collection_revisions WHERE id = NEW.published_revision_id AND record_id = NEW.id AND kind = 'auto-publish'
)
BEGIN SELECT RAISE(ABORT, 'Invalid published collection revision'); END;
--> statement-breakpoint
-- Existing field contracts are immutable. Additions are allowed only after
-- every draft has been backfilled in the same transaction as the schema sync.
-- This also closes the race with creating a collection's first record.
CREATE TRIGGER collection_schema_guard BEFORE UPDATE OF content_schema ON collection_definitions
WHEN OLD.content_schema != NEW.content_schema
AND EXISTS (SELECT 1 FROM collection_records WHERE definition_id = OLD.id)
AND (
  EXISTS (
    SELECT 1 FROM json_each(OLD.content_schema, '$.properties') AS previous
    LEFT JOIN json_each(NEW.content_schema, '$.properties') AS incoming
      ON incoming.key = previous.key
    WHERE incoming.key IS NULL OR incoming.value != previous.value
  )
  OR EXISTS (
    SELECT 1 FROM collection_records AS record,
      json_each(NEW.content_schema, '$.properties') AS field
    WHERE record.definition_id = OLD.id
    AND NOT EXISTS (
      SELECT 1 FROM json_each(record.draft) AS content WHERE content.key = field.key
    )
  )
)
BEGIN SELECT RAISE(ABORT, 'Collection schema changes require compatible draft backfills'); END;
--> statement-breakpoint
CREATE TRIGGER collection_active_guard BEFORE INSERT ON collection_records
WHEN NOT EXISTS (SELECT 1 FROM collection_definitions WHERE id = NEW.definition_id AND active = 1)
BEGIN SELECT RAISE(ABORT, 'Collection definition is retired'); END;
--> statement-breakpoint
-- Reference identities remain in authored content. These views are a dependency
-- index over draft placements, current checkpoints and independently shared live data.
-- D1 allows at most five terms per compound SELECT, so block, item and record
-- placements are separate views, combined by the placements view.
-- Repeatable items are read against their item schema, found by walking their
-- repeater path from the block's content schema. Collection records are read
-- against the schema their draft or published revision was written with.
-- Query-backed reference lists are resolved content, not placements: a list field
-- whose schema carries a `query` never enters the dependency index.
CREATE VIEW collection_reference_block_placements AS
SELECT d.project_id, d.environment_id, d.content_schema, b.content, 0 AS live,
  b.page_id, b.layout_id, b.id AS block_id, d.id AS block_definition_id
FROM blocks b
LEFT JOIN pages p ON p.id = b.page_id
LEFT JOIN layouts l ON l.id = b.layout_id
JOIN block_definitions d ON d.block_id = b.type
  AND d.environment_id = coalesce(p.environment_id, l.environment_id)
UNION ALL
SELECT d.project_id, d.environment_id, d.content_schema,
  CASE WHEN d.synced = 1 AND d.synced_published_data IS NOT NULL
    THEN json_extract(d.synced_published_data, '$.block.content')
    ELSE json_extract(b.value, '$.content') END,
  1, p.id, NULL, json_extract(b.value, '$.id'), d.id
FROM pages p JOIN page_checkpoints c ON c.id = p.live_published_checkpoint_id,
json_each(c.snapshot, '$.blocks') b
JOIN block_definitions d ON d.environment_id = p.environment_id
  AND d.block_id = json_extract(b.value, '$.type')
UNION ALL
SELECT d.project_id, d.environment_id, d.content_schema,
  CASE WHEN d.synced = 1 AND d.synced_published_data IS NOT NULL
    THEN json_extract(d.synced_published_data, '$.block.content')
    ELSE json_extract(b.value, '$.content') END,
  1, NULL, l.id, json_extract(b.value, '$.id'), d.id
FROM layouts l JOIN layout_checkpoints c ON c.id = l.live_published_checkpoint_id,
json_each(c.snapshot, '$.blocks') b
JOIN block_definitions d ON d.environment_id = l.environment_id
  AND d.block_id = json_extract(b.value, '$.type')
UNION ALL
SELECT project_id, environment_id, content_schema,
  json_extract(synced_published_data, '$.block.content'), 1, NULL, NULL,
  json_extract(synced_published_data, '$.block.id'), id
FROM block_definitions WHERE synced = 1 AND synced_published_data IS NOT NULL;
--> statement-breakpoint
CREATE VIEW collection_reference_item_placements AS
WITH RECURSIVE
draft_items(project_id, environment_id, content_schema, content, page_id, layout_id,
  block_id, block_definition_id, item_id) AS (
  SELECT d.project_id, d.environment_id,
    json_extract(d.content_schema, '$.properties."' || i.field_name || '".items'),
    i.content, b.page_id, b.layout_id, b.id, d.id, i.id
  FROM repeatable_items i
  JOIN blocks b ON b.id = i.block_id
  LEFT JOIN pages p ON p.id = b.page_id
  LEFT JOIN layouts l ON l.id = b.layout_id
  JOIN block_definitions d ON d.block_id = b.type
    AND d.environment_id = coalesce(p.environment_id, l.environment_id)
  WHERE i.parent_item_id IS NULL
  UNION ALL
  SELECT parent.project_id, parent.environment_id,
    json_extract(parent.content_schema, '$.properties."' || i.field_name || '".items'),
    i.content, parent.page_id, parent.layout_id, parent.block_id,
    parent.block_definition_id, i.id
  FROM repeatable_items i JOIN draft_items parent ON i.parent_item_id = parent.item_id
),
-- Each live block's item rows: its checkpoint's items, or its type's shared live items.
live_containers(project_id, environment_id, block_schema, page_id, layout_id, block_id,
  block_definition_id, items, shared) AS (
  SELECT d.project_id, d.environment_id, d.content_schema, p.id, NULL,
    json_extract(b.value, '$.id'), d.id,
    CASE WHEN d.synced = 1 AND d.synced_published_data IS NOT NULL
      THEN json_extract(d.synced_published_data, '$.items')
      ELSE json_extract(c.snapshot, '$.repeatableItems') END,
    d.synced = 1 AND d.synced_published_data IS NOT NULL
  FROM pages p JOIN page_checkpoints c ON c.id = p.live_published_checkpoint_id,
  json_each(c.snapshot, '$.blocks') b
  JOIN block_definitions d ON d.environment_id = p.environment_id
    AND d.block_id = json_extract(b.value, '$.type')
  UNION ALL
  SELECT d.project_id, d.environment_id, d.content_schema, NULL, l.id,
    json_extract(b.value, '$.id'), d.id,
    CASE WHEN d.synced = 1 AND d.synced_published_data IS NOT NULL
      THEN json_extract(d.synced_published_data, '$.items')
      ELSE json_extract(c.snapshot, '$.repeatableItems') END,
    d.synced = 1 AND d.synced_published_data IS NOT NULL
  FROM layouts l JOIN layout_checkpoints c ON c.id = l.live_published_checkpoint_id,
  json_each(c.snapshot, '$.blocks') b
  JOIN block_definitions d ON d.environment_id = l.environment_id
    AND d.block_id = json_extract(b.value, '$.type')
  UNION ALL
  SELECT project_id, environment_id, content_schema, NULL, NULL,
    json_extract(synced_published_data, '$.block.id'), id,
    json_extract(synced_published_data, '$.items'), 1
  FROM block_definitions WHERE synced = 1 AND synced_published_data IS NOT NULL
),
live_items(project_id, environment_id, content_schema, content, page_id, layout_id,
  block_id, block_definition_id, items, item_id) AS (
  SELECT o.project_id, o.environment_id,
    json_extract(o.block_schema,
      '$.properties."' || json_extract(i.value, '$.fieldName') || '".items'),
    json_extract(i.value, '$.content'), o.page_id, o.layout_id, o.block_id,
    o.block_definition_id, o.items, json_extract(i.value, '$.id')
  FROM live_containers o, json_each(o.items) i
  WHERE json_extract(i.value, '$.parentItemId') IS NULL
    -- Shared items all belong to their type's one block; checkpoint items to their own.
    AND (o.shared OR json_extract(i.value, '$.blockId') = o.block_id)
  UNION ALL
  SELECT parent.project_id, parent.environment_id,
    json_extract(parent.content_schema,
      '$.properties."' || json_extract(i.value, '$.fieldName') || '".items'),
    json_extract(i.value, '$.content'), parent.page_id, parent.layout_id, parent.block_id,
    parent.block_definition_id, parent.items, json_extract(i.value, '$.id')
  FROM live_items parent, json_each(parent.items) i
  WHERE json_extract(i.value, '$.parentItemId') = parent.item_id
)
SELECT project_id, environment_id, content_schema, content, 0 AS live, page_id, layout_id,
  block_id, block_definition_id
FROM draft_items WHERE content_schema IS NOT NULL
UNION ALL
SELECT project_id, environment_id, content_schema, content, 1, page_id, layout_id,
  block_id, block_definition_id
FROM live_items WHERE content_schema IS NOT NULL;
--> statement-breakpoint
CREATE VIEW collection_reference_record_placements AS
SELECT d.project_id, d.environment_id, d.content_schema, r.draft AS content, 0 AS live,
  NULL AS page_id, NULL AS layout_id, NULL AS block_id, NULL AS block_definition_id,
  r.id AS source_record_id
FROM collection_records r JOIN collection_definitions d ON d.id = r.definition_id
UNION ALL
SELECT d.project_id, d.environment_id, json_extract(v.definition, '$.contentSchema'),
  v.content, 1, NULL, NULL, NULL, NULL, r.id
FROM collection_records r
JOIN collection_revisions v ON v.id = r.published_revision_id
JOIN collection_definitions d ON d.id = r.definition_id;
--> statement-breakpoint
CREATE VIEW collection_reference_placements AS
SELECT *, NULL AS source_record_id FROM collection_reference_block_placements
UNION ALL
SELECT *, NULL AS source_record_id FROM collection_reference_item_placements
UNION ALL
SELECT * FROM collection_reference_record_placements;
--> statement-breakpoint
CREATE VIEW collection_reference_uses AS
SELECT p.project_id, p.environment_id, d.id AS definition_id, v.value AS record_id,
  p.live, p.page_id, p.layout_id, p.block_id, p.block_definition_id, p.source_record_id,
  coalesce(json_extract(f.value, '$.required'), 0) AS required
FROM collection_reference_placements p,
json_each(p.content_schema, '$.properties') f
LEFT JOIN json_each(p.content) v ON v.key = f.key
LEFT JOIN collection_definitions d ON d.project_id = p.project_id
  AND d.environment_id = p.environment_id
  AND d.collection_id = json_extract(f.value, '$.collectionId')
WHERE json_extract(f.value, '$.fieldType') = 'Reference'
UNION ALL
SELECT p.project_id, p.environment_id, d.id AS definition_id, e.value AS record_id,
  p.live, p.page_id, p.layout_id, p.block_id, p.block_definition_id, p.source_record_id,
  0 AS required
FROM collection_reference_placements p,
json_each(p.content_schema, '$.properties') f
JOIN json_each(p.content) v ON v.key = f.key AND v.type = 'array'
JOIN json_each(v.value) e
LEFT JOIN collection_definitions d ON d.project_id = p.project_id
  AND d.environment_id = p.environment_id
  AND d.collection_id = json_extract(f.value, '$.collectionId')
WHERE json_extract(f.value, '$.fieldType') = 'ReferenceList'
  AND json_type(f.value, '$.query') IS NULL;
--> statement-breakpoint
-- Deleting a record that any placement links is refused. Unpublishing a record or
-- retiring a collection that published content requires is refused, and so is
-- publishing a page, layout or synced block that requires an unpublished record.
CREATE TRIGGER collection_record_reference_delete_guard BEFORE DELETE ON collection_records
WHEN EXISTS (SELECT 1 FROM collection_reference_uses u WHERE u.record_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'Collection item is still referenced'); END;
--> statement-breakpoint
CREATE TRIGGER collection_record_reference_unpublish_guard BEFORE UPDATE OF published_revision_id ON collection_records
WHEN NEW.published_revision_id IS NULL AND EXISTS (
  SELECT 1 FROM collection_reference_uses u WHERE u.record_id = OLD.id AND u.live = 1 AND u.required = 1
)
BEGIN SELECT RAISE(ABORT, 'Collection item is required by published content'); END;
--> statement-breakpoint
CREATE TRIGGER collection_definition_reference_retire_guard BEFORE UPDATE OF active ON collection_definitions
WHEN NEW.active = 0 AND EXISTS (
  SELECT 1 FROM collection_reference_uses u WHERE u.definition_id = OLD.id AND u.live = 1 AND u.required = 1
)
BEGIN SELECT RAISE(ABORT, 'Collection is required by published content'); END;
--> statement-breakpoint
CREATE TRIGGER page_reference_publish_guard AFTER UPDATE OF live_published_checkpoint_id ON pages
WHEN NEW.live_published_checkpoint_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.page_id = NEW.id AND u.live = 1 AND u.required = 1
    AND (r.published_revision_id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Required collection item is not published'); END;
--> statement-breakpoint
CREATE TRIGGER layout_reference_publish_guard AFTER UPDATE OF live_published_checkpoint_id ON layouts
WHEN NEW.live_published_checkpoint_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.layout_id = NEW.id AND u.live = 1 AND u.required = 1
    AND (r.published_revision_id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Required collection item is not published'); END;
--> statement-breakpoint
CREATE TRIGGER synced_reference_publish_guard AFTER UPDATE OF synced_published_data ON block_definitions
WHEN NEW.synced = 1 AND NEW.synced_published_data IS NOT NULL AND EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.block_definition_id = NEW.id AND u.live = 1 AND u.required = 1
    AND (r.published_revision_id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Required collection item is not published'); END;
--> statement-breakpoint
-- Service validation provides actionable errors; these checks close the race
-- with a concurrent record deletion after validation but before placement writes.
-- Guard triggers read the uses view by name at run time.
CREATE TRIGGER block_reference_insert_guard AFTER INSERT ON blocks
WHEN EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.block_id = NEW.id AND u.live = 0 AND u.record_id IS NOT NULL
    AND (r.id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Collection reference is missing or outside this scope'); END;
--> statement-breakpoint
CREATE TRIGGER block_reference_update_guard AFTER UPDATE OF content, type, page_id, layout_id ON blocks
WHEN EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.block_id = NEW.id AND u.live = 0 AND u.record_id IS NOT NULL
    AND (r.id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Collection reference is missing or outside this scope'); END;
--> statement-breakpoint
CREATE TRIGGER repeatable_item_reference_insert_guard AFTER INSERT ON repeatable_items
WHEN EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.block_id = NEW.block_id AND u.live = 0 AND u.record_id IS NOT NULL
    AND (r.id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Collection reference is missing or outside this scope'); END;
--> statement-breakpoint
CREATE TRIGGER repeatable_item_reference_update_guard AFTER UPDATE OF content, field_name, parent_item_id, block_id ON repeatable_items
WHEN EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.block_id = NEW.block_id AND u.live = 0 AND u.record_id IS NOT NULL
    AND (r.id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Collection reference is missing or outside this scope'); END;
--> statement-breakpoint
CREATE TRIGGER collection_record_reference_insert_guard AFTER INSERT ON collection_records
WHEN EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.source_record_id = NEW.id AND u.live = 0 AND u.record_id IS NOT NULL
    AND (r.id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Collection reference is missing or outside this scope'); END;
--> statement-breakpoint
CREATE TRIGGER collection_record_reference_update_guard AFTER UPDATE OF draft ON collection_records
WHEN EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.source_record_id = NEW.id AND u.live = 0 AND u.record_id IS NOT NULL
    AND (r.id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Collection reference is missing or outside this scope'); END;
