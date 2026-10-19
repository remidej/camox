DROP INDEX `translation_requests_key_idx`;--> statement-breakpoint
ALTER TABLE `translation_requests` ADD `source` text DEFAULT 'defaultLocale' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `translation_requests_key_idx` ON `translation_requests` (`draft_id`,`entity`,`entity_id`,`locale`,`source`);