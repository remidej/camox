-- Every existing project gets `en` as its default locale, on Live: the locale its content was
-- assigned to when content tables gained a locale. The id is a UUIDv7 minted in SQL.
INSERT INTO `locales` (`id`, `draft_id`, `project_id`, `tag`, `is_default`, `created_at`, `updated_at`)
SELECT
	substr(`ms`, 1, 8) || '-' || substr(`ms`, 9, 4)
		|| '-7' || substr(lower(hex(randomblob(2))), 2)
		|| '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2)
		|| '-' || lower(hex(randomblob(6))),
	NULL,
	`id`,
	'en',
	1,
	`now`,
	`now`
FROM (
	SELECT
		`id`,
		cast((julianday('now') - 2440587.5) * 86400000 AS integer) AS `now`,
		printf('%012x', cast((julianday('now') - 2440587.5) * 86400000 AS integer)) AS `ms`
	FROM `projects`
);
