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
-- History is append-only. A pointer may only select this record's publication.
CREATE TRIGGER collection_revisions_immutable BEFORE UPDATE ON collection_revisions
BEGIN SELECT RAISE(ABORT, 'Collection revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER collection_published_revision_owner BEFORE UPDATE OF published_revision_id ON collection_records
WHEN NEW.published_revision_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM collection_revisions WHERE id = NEW.published_revision_id AND record_id = NEW.id AND kind = 'auto-publish'
)
BEGIN SELECT RAISE(ABORT, 'Invalid published collection revision'); END;
--> statement-breakpoint
CREATE TRIGGER collection_schema_guard BEFORE UPDATE OF content_schema ON collection_definitions
WHEN OLD.content_schema != NEW.content_schema AND EXISTS (
  SELECT 1 FROM collection_records WHERE definition_id = OLD.id
)
BEGIN SELECT RAISE(ABORT, 'Collection schema migration is not supported'); END;
--> statement-breakpoint
CREATE TRIGGER collection_active_guard BEFORE INSERT ON collection_records
WHEN NOT EXISTS (SELECT 1 FROM collection_definitions WHERE id = NEW.definition_id AND active = 1)
BEGIN SELECT RAISE(ABORT, 'Collection definition is retired'); END;
