ALTER TABLE `findings` ADD `handed_at` integer;--> statement-breakpoint
-- Live's findings raised before this were handed to the Patrol Draft as they were raised.
UPDATE `findings` SET `handed_at` = `raised_at` WHERE `draft_id` IS NULL;
