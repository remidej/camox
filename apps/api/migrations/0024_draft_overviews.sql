ALTER TABLE `drafts` ADD `overview_headline` text;--> statement-breakpoint
ALTER TABLE `drafts` ADD `overview_bullets` text;--> statement-breakpoint
ALTER TABLE `drafts` ADD `overview_requested_at` integer;--> statement-breakpoint
ALTER TABLE `drafts` ADD `overview_due_at` integer;--> statement-breakpoint
ALTER TABLE `drafts` ADD `overview_generated_at` integer;--> statement-breakpoint
ALTER TABLE `drafts` ADD `overview_fingerprint` text;--> statement-breakpoint
ALTER TABLE `drafts` ADD `overview_failed` integer DEFAULT false NOT NULL;