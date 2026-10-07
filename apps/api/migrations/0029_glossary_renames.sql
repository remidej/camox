ALTER TABLE `projects` RENAME COLUMN `sync_secret` TO `deploy_token`;
--> statement-breakpoint
ALTER TABLE `blocks` RENAME COLUMN `placement` TO `slot`;
--> statement-breakpoint
-- Checkpoint snapshots and synced live data mirror block rows, so their JSON
-- keys follow the column rename. Block order is preserved explicitly.
UPDATE `page_checkpoints` SET `snapshot` = json_set(`snapshot`, '$.blocks', (
  SELECT json_group_array(json(block)) FROM (
    SELECT json_remove(json_set(value, '$.slot', json_extract(value, '$.placement')), '$.placement') AS block
    FROM json_each(`snapshot`, '$.blocks')
    ORDER BY key
  )
))
WHERE json_type(`snapshot`, '$.blocks') = 'array';
--> statement-breakpoint
UPDATE `layout_checkpoints` SET `snapshot` = json_set(`snapshot`, '$.blocks', (
  SELECT json_group_array(json(block)) FROM (
    SELECT json_remove(json_set(value, '$.slot', json_extract(value, '$.placement')), '$.placement') AS block
    FROM json_each(`snapshot`, '$.blocks')
    ORDER BY key
  )
))
WHERE json_type(`snapshot`, '$.blocks') = 'array';
--> statement-breakpoint
UPDATE `block_definitions` SET `synced_published_data` = json_remove(
  json_set(`synced_published_data`, '$.block.slot', json_extract(`synced_published_data`, '$.block.placement')),
  '$.block.placement'
)
WHERE json_type(`synced_published_data`, '$.block') = 'object';
