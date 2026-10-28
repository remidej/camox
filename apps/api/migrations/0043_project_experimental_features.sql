-- Whether the studio shows experimental features: a Project Setting, off for every project.
ALTER TABLE `projects` ADD `experimental_features` integer DEFAULT false NOT NULL;