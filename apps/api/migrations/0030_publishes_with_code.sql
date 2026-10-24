ALTER TABLE `drafts` ADD `publishing_revision_id` text;--> statement-breakpoint
ALTER TABLE `drafts` ADD `publish_instance_id` text;--> statement-breakpoint
ALTER TABLE `drafts` ADD `publish_requested_at` integer;--> statement-breakpoint
ALTER TABLE `drafts` ADD `publish_abort_reason` text;