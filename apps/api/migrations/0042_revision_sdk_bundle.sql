-- The SDK Bundle a revision's build names (ADR 0029): null for a whole-app build.
ALTER TABLE `revisions` ADD `sdk_bundle` text;
