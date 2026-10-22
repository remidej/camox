-- A collection's `label` field name becomes the title template naming that field. The default
-- only fills existing rows: every sync writes the template.
ALTER TABLE `collection_definitions` ADD `to_title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `collection_definitions` ADD `to_description` text;--> statement-breakpoint
UPDATE `collection_definitions` SET `to_title` = '{{' || `label` || '}}';--> statement-breakpoint
ALTER TABLE `collection_definitions` DROP COLUMN `label`;
