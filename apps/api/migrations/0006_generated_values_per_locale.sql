DROP INDEX `generated_values_live_idx`;--> statement-breakpoint
DROP INDEX `generated_values_draft_idx`;--> statement-breakpoint
ALTER TABLE `generated_values` ADD `locale` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `generated_values_live_idx` ON `generated_values` (`entity`,`entity_id`,`type`,`locale`) WHERE "generated_values"."draft_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `generated_values_draft_idx` ON `generated_values` (`draft_id`,`entity`,`entity_id`,`type`,`locale`) WHERE "generated_values"."draft_id" is not null;--> statement-breakpoint
ALTER TABLE `files` ADD `alts_by_locale` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- Existing values are in their project's default locale, whose tag may have been corrected since.
UPDATE `generated_values` SET `locale` = coalesce((SELECT `tag` FROM `locales` WHERE `locales`.`project_id` = `generated_values`.`project_id` AND `locales`.`is_default` = 1 AND `locales`.`draft_id` IS NULL), 'en');
