ALTER TABLE `projects` ADD `custom_domain` text;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_custom_domain_idx` ON `projects` (`custom_domain`);