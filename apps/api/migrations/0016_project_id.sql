-- SQLite only adds a NOT NULL column with a default. The API mints every Project ID itself, so
-- the schema leaves this '' out, and the unique index refuses a second project without one.
ALTER TABLE `projects` ADD `uuid` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- camox-landing's Project ID is fixed, so its `camox()` config can name it before this runs.
UPDATE `projects` SET `uuid` = '01a15fff-627a-72f1-ba3b-dc5fde0bbb45' WHERE `slug` = 'camox-landing';--> statement-breakpoint
-- Every other project gets a random lowercase UUIDv7, timestamped with when it was created.
UPDATE `projects` SET `uuid` = lower(
	substr(printf('%012x', `created_at`), 1, 8) || '-' ||
	substr(printf('%012x', `created_at`), 9, 4) || '-' ||
	'7' || substr(hex(randomblob(2)), 2, 3) || '-' ||
	substr('89ab', 1 + abs(random() % 4), 1) || substr(hex(randomblob(2)), 2, 3) || '-' ||
	hex(randomblob(6))
) WHERE `uuid` = '';--> statement-breakpoint
CREATE UNIQUE INDEX `projects_uuid_idx` ON `projects` (`uuid`);
