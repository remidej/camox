DROP INDEX `drafts_catch_up_idx`;--> statement-breakpoint
ALTER TABLE `drafts` ADD `purpose` text;--> statement-breakpoint
UPDATE `drafts` SET `purpose` = 'catchUp' WHERE `created_by` = 'camox';--> statement-breakpoint
CREATE UNIQUE INDEX `drafts_purpose_idx` ON `drafts` (`project_id`,`purpose`) WHERE "drafts"."purpose" is not null;
