ALTER TABLE `projects` ADD `status` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `setup_step` text;