CREATE TABLE `translation_claims` (
	`row_id` integer PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`locale` text NOT NULL,
	`space` text NOT NULL,
	`value` text NOT NULL,
	`entity_id` text NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `translation_claims_value_idx` ON `translation_claims` (`draft_id`,`locale`,`space`,`value`);--> statement-breakpoint
CREATE INDEX `translation_claims_entity_idx` ON `translation_claims` (`draft_id`,`entity_id`);