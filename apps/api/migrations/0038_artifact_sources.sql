CREATE TABLE `artifact_sources` (
	`project_id` integer NOT NULL,
	`hash` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `hash`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
