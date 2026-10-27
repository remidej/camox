-- Drafts are deleted, no longer discarded.
UPDATE `ended_drafts` SET `outcome` = 'deleted' WHERE `outcome` = 'discarded';
