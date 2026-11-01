-- A draft's name is Camox's now: an unnamed draft takes the name its overview already suggested.
UPDATE `drafts` SET `name` = `overview_name` WHERE `name` IS NULL AND `overview_name` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `drafts` DROP COLUMN `overview_name`;
