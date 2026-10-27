-- Development drafts are gone (ADR 0027): delete them and every row they store. Each table's
-- rows are deleted by name, not left to the cascade, so this holds whatever the foreign key
-- setting.
DELETE FROM `layouts` WHERE `draft_id` IN (SELECT `id` FROM `drafts` WHERE `kind` = 'development');
--> statement-breakpoint
DELETE FROM `pages` WHERE `draft_id` IN (SELECT `id` FROM `drafts` WHERE `kind` = 'development');
--> statement-breakpoint
DELETE FROM `block_definitions` WHERE `draft_id` IN (SELECT `id` FROM `drafts` WHERE `kind` = 'development');
--> statement-breakpoint
DELETE FROM `blocks` WHERE `draft_id` IN (SELECT `id` FROM `drafts` WHERE `kind` = 'development');
--> statement-breakpoint
DELETE FROM `shared_contents` WHERE `draft_id` IN (SELECT `id` FROM `drafts` WHERE `kind` = 'development');
--> statement-breakpoint
DELETE FROM `repeatable_items` WHERE `draft_id` IN (SELECT `id` FROM `drafts` WHERE `kind` = 'development');
--> statement-breakpoint
DELETE FROM `files` WHERE `draft_id` IN (SELECT `id` FROM `drafts` WHERE `kind` = 'development');
--> statement-breakpoint
DELETE FROM `collection_definitions` WHERE `draft_id` IN (SELECT `id` FROM `drafts` WHERE `kind` = 'development');
--> statement-breakpoint
DELETE FROM `collection_records` WHERE `draft_id` IN (SELECT `id` FROM `drafts` WHERE `kind` = 'development');
--> statement-breakpoint
DELETE FROM `generated_values` WHERE `draft_id` IN (SELECT `id` FROM `drafts` WHERE `kind` = 'development');
--> statement-breakpoint
DELETE FROM `locales` WHERE `draft_id` IN (SELECT `id` FROM `drafts` WHERE `kind` = 'development');
--> statement-breakpoint
DELETE FROM `localization_exclusions` WHERE `draft_id` IN (SELECT `id` FROM `drafts` WHERE `kind` = 'development');
--> statement-breakpoint
DELETE FROM `translation_bookkeeping` WHERE `draft_id` IN (SELECT `id` FROM `drafts` WHERE `kind` = 'development');
--> statement-breakpoint
DELETE FROM `translation_claims` WHERE `draft_id` IN (SELECT `id` FROM `drafts` WHERE `kind` = 'development');
--> statement-breakpoint
DELETE FROM `translation_requests` WHERE `draft_id` IN (SELECT `id` FROM `drafts` WHERE `kind` = 'development');
--> statement-breakpoint
DELETE FROM `revisions` WHERE `draft_id` IN (SELECT `id` FROM `drafts` WHERE `kind` = 'development');
--> statement-breakpoint
DELETE FROM `reports` WHERE `draft_id` IN (SELECT `id` FROM `drafts` WHERE `kind` = 'development');
--> statement-breakpoint
DELETE FROM `drafts` WHERE `kind` = 'development';
--> statement-breakpoint
DROP INDEX `drafts_development_idx`;--> statement-breakpoint
DROP INDEX `drafts_catch_up_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `drafts_catch_up_idx` ON `drafts` (`project_id`) WHERE "drafts"."created_by" = 'camox';--> statement-breakpoint
ALTER TABLE `drafts` DROP COLUMN `kind`;