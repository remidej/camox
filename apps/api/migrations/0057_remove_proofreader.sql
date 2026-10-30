DROP TABLE `proofreading_requests`;--> statement-breakpoint
DELETE FROM `findings` WHERE `patroller` = 'proofreader';--> statement-breakpoint
DELETE FROM `finding_dismissals` WHERE `patroller` = 'proofreader';--> statement-breakpoint
DELETE FROM `reports` WHERE `patroller` = 'proofreader';--> statement-breakpoint
DELETE FROM `patrol_checks` WHERE `patroller` = 'proofreader';
