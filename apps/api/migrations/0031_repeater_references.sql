-- Repeatable items join the dependency index as placements of their own: an item's content
-- is read against its item schema, found by walking its repeater path from the block's
-- content schema. Draft items come from repeatable_items; live items from current
-- checkpoints and independently shared live data, like their blocks.
-- Guard triggers read the uses view by name at run time, so they stay unchanged.
-- D1 allows at most five terms per compound SELECT, so block and item placements are
-- separate views, combined by the placements view.
DROP VIEW collection_reference_uses;
--> statement-breakpoint
DROP VIEW collection_reference_placements;
--> statement-breakpoint
CREATE VIEW collection_reference_block_placements AS
SELECT d.project_id, d.environment_id, d.content_schema, b.content, 0 AS live,
  b.page_id, b.layout_id, b.id AS block_id, d.id AS block_definition_id
FROM blocks b
LEFT JOIN pages p ON p.id = b.page_id
LEFT JOIN layouts l ON l.id = b.layout_id
JOIN block_definitions d ON d.block_id = b.type
  AND d.environment_id = coalesce(p.environment_id, l.environment_id)
UNION ALL
SELECT d.project_id, d.environment_id, d.content_schema,
  CASE WHEN d.synced = 1 AND d.synced_published_data IS NOT NULL
    THEN json_extract(d.synced_published_data, '$.block.content')
    ELSE json_extract(b.value, '$.content') END,
  1, p.id, NULL, json_extract(b.value, '$.id'), d.id
FROM pages p JOIN page_checkpoints c ON c.id = p.live_published_checkpoint_id,
json_each(c.snapshot, '$.blocks') b
JOIN block_definitions d ON d.environment_id = p.environment_id
  AND d.block_id = json_extract(b.value, '$.type')
UNION ALL
SELECT d.project_id, d.environment_id, d.content_schema,
  CASE WHEN d.synced = 1 AND d.synced_published_data IS NOT NULL
    THEN json_extract(d.synced_published_data, '$.block.content')
    ELSE json_extract(b.value, '$.content') END,
  1, NULL, l.id, json_extract(b.value, '$.id'), d.id
FROM layouts l JOIN layout_checkpoints c ON c.id = l.live_published_checkpoint_id,
json_each(c.snapshot, '$.blocks') b
JOIN block_definitions d ON d.environment_id = l.environment_id
  AND d.block_id = json_extract(b.value, '$.type')
UNION ALL
SELECT project_id, environment_id, content_schema,
  json_extract(synced_published_data, '$.block.content'), 1, NULL, NULL,
  json_extract(synced_published_data, '$.block.id'), id
FROM block_definitions WHERE synced = 1 AND synced_published_data IS NOT NULL;
--> statement-breakpoint
CREATE VIEW collection_reference_item_placements AS
WITH RECURSIVE
draft_items(project_id, environment_id, content_schema, content, page_id, layout_id,
  block_id, block_definition_id, item_id) AS (
  SELECT d.project_id, d.environment_id,
    json_extract(d.content_schema, '$.properties."' || i.field_name || '".items'),
    i.content, b.page_id, b.layout_id, b.id, d.id, i.id
  FROM repeatable_items i
  JOIN blocks b ON b.id = i.block_id
  LEFT JOIN pages p ON p.id = b.page_id
  LEFT JOIN layouts l ON l.id = b.layout_id
  JOIN block_definitions d ON d.block_id = b.type
    AND d.environment_id = coalesce(p.environment_id, l.environment_id)
  WHERE i.parent_item_id IS NULL
  UNION ALL
  SELECT parent.project_id, parent.environment_id,
    json_extract(parent.content_schema, '$.properties."' || i.field_name || '".items'),
    i.content, parent.page_id, parent.layout_id, parent.block_id,
    parent.block_definition_id, i.id
  FROM repeatable_items i JOIN draft_items parent ON i.parent_item_id = parent.item_id
),
-- Each live block's item rows: its checkpoint's items, or its type's shared live items.
live_containers(project_id, environment_id, block_schema, page_id, layout_id, block_id,
  block_definition_id, items, shared) AS (
  SELECT d.project_id, d.environment_id, d.content_schema, p.id, NULL,
    json_extract(b.value, '$.id'), d.id,
    CASE WHEN d.synced = 1 AND d.synced_published_data IS NOT NULL
      THEN json_extract(d.synced_published_data, '$.items')
      ELSE json_extract(c.snapshot, '$.repeatableItems') END,
    d.synced = 1 AND d.synced_published_data IS NOT NULL
  FROM pages p JOIN page_checkpoints c ON c.id = p.live_published_checkpoint_id,
  json_each(c.snapshot, '$.blocks') b
  JOIN block_definitions d ON d.environment_id = p.environment_id
    AND d.block_id = json_extract(b.value, '$.type')
  UNION ALL
  SELECT d.project_id, d.environment_id, d.content_schema, NULL, l.id,
    json_extract(b.value, '$.id'), d.id,
    CASE WHEN d.synced = 1 AND d.synced_published_data IS NOT NULL
      THEN json_extract(d.synced_published_data, '$.items')
      ELSE json_extract(c.snapshot, '$.repeatableItems') END,
    d.synced = 1 AND d.synced_published_data IS NOT NULL
  FROM layouts l JOIN layout_checkpoints c ON c.id = l.live_published_checkpoint_id,
  json_each(c.snapshot, '$.blocks') b
  JOIN block_definitions d ON d.environment_id = l.environment_id
    AND d.block_id = json_extract(b.value, '$.type')
  UNION ALL
  SELECT project_id, environment_id, content_schema, NULL, NULL,
    json_extract(synced_published_data, '$.block.id'), id,
    json_extract(synced_published_data, '$.items'), 1
  FROM block_definitions WHERE synced = 1 AND synced_published_data IS NOT NULL
),
live_items(project_id, environment_id, content_schema, content, page_id, layout_id,
  block_id, block_definition_id, items, item_id) AS (
  SELECT o.project_id, o.environment_id,
    json_extract(o.block_schema,
      '$.properties."' || json_extract(i.value, '$.fieldName') || '".items'),
    json_extract(i.value, '$.content'), o.page_id, o.layout_id, o.block_id,
    o.block_definition_id, o.items, json_extract(i.value, '$.id')
  FROM live_containers o, json_each(o.items) i
  WHERE json_extract(i.value, '$.parentItemId') IS NULL
    -- Shared items all belong to their type's one block; checkpoint items to their own.
    AND (o.shared OR json_extract(i.value, '$.blockId') = o.block_id)
  UNION ALL
  SELECT parent.project_id, parent.environment_id,
    json_extract(parent.content_schema,
      '$.properties."' || json_extract(i.value, '$.fieldName') || '".items'),
    json_extract(i.value, '$.content'), parent.page_id, parent.layout_id, parent.block_id,
    parent.block_definition_id, parent.items, json_extract(i.value, '$.id')
  FROM live_items parent, json_each(parent.items) i
  WHERE json_extract(i.value, '$.parentItemId') = parent.item_id
)
SELECT project_id, environment_id, content_schema, content, 0 AS live, page_id, layout_id,
  block_id, block_definition_id
FROM draft_items WHERE content_schema IS NOT NULL
UNION ALL
SELECT project_id, environment_id, content_schema, content, 1, page_id, layout_id,
  block_id, block_definition_id
FROM live_items WHERE content_schema IS NOT NULL;
--> statement-breakpoint
CREATE VIEW collection_reference_placements AS
SELECT * FROM collection_reference_block_placements
UNION ALL
SELECT * FROM collection_reference_item_placements;
--> statement-breakpoint
CREATE VIEW collection_reference_uses AS
SELECT p.project_id, p.environment_id, d.id AS definition_id, v.value AS record_id,
  p.live, p.page_id, p.layout_id, p.block_id, p.block_definition_id,
  coalesce(json_extract(f.value, '$.required'), 0) AS required
FROM collection_reference_placements p,
json_each(p.content_schema, '$.properties') f
LEFT JOIN json_each(p.content) v ON v.key = f.key
LEFT JOIN collection_definitions d ON d.project_id = p.project_id
  AND d.environment_id = p.environment_id
  AND d.collection_id = json_extract(f.value, '$.collectionId')
WHERE json_extract(f.value, '$.fieldType') = 'Reference'
UNION ALL
SELECT p.project_id, p.environment_id, d.id AS definition_id, e.value AS record_id,
  p.live, p.page_id, p.layout_id, p.block_id, p.block_definition_id,
  0 AS required
FROM collection_reference_placements p,
json_each(p.content_schema, '$.properties') f
JOIN json_each(p.content) v ON v.key = f.key AND v.type = 'array'
JOIN json_each(v.value) e
LEFT JOIN collection_definitions d ON d.project_id = p.project_id
  AND d.environment_id = p.environment_id
  AND d.collection_id = json_extract(f.value, '$.collectionId')
WHERE json_extract(f.value, '$.fieldType') = 'ReferenceList';
--> statement-breakpoint
-- Item writes get the same race guard as block writes; uses are indexed by their block.
CREATE TRIGGER repeatable_item_reference_insert_guard AFTER INSERT ON repeatable_items
WHEN EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.block_id = NEW.block_id AND u.live = 0 AND u.record_id IS NOT NULL
    AND (r.id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Collection reference is missing or outside this scope'); END;
--> statement-breakpoint
CREATE TRIGGER repeatable_item_reference_update_guard AFTER UPDATE OF content, field_name, parent_item_id, block_id ON repeatable_items
WHEN EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.block_id = NEW.block_id AND u.live = 0 AND u.record_id IS NOT NULL
    AND (r.id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Collection reference is missing or outside this scope'); END;
