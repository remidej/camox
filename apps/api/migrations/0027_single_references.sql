-- Reference identities remain in authored content. This projection is a dependency
-- index over draft placements, current checkpoints and independently shared live data.
CREATE VIEW collection_reference_placements AS
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
WHERE json_extract(f.value, '$.fieldType') = 'Reference';
--> statement-breakpoint
CREATE TRIGGER collection_record_reference_delete_guard BEFORE DELETE ON collection_records
WHEN EXISTS (SELECT 1 FROM collection_reference_uses u WHERE u.record_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'Collection item is still referenced'); END;
--> statement-breakpoint
CREATE TRIGGER collection_record_reference_unpublish_guard BEFORE UPDATE OF published_revision_id ON collection_records
WHEN NEW.published_revision_id IS NULL AND EXISTS (
  SELECT 1 FROM collection_reference_uses u WHERE u.record_id = OLD.id AND u.live = 1 AND u.required = 1
)
BEGIN SELECT RAISE(ABORT, 'Collection item is required by published content'); END;
--> statement-breakpoint
CREATE TRIGGER collection_definition_reference_retire_guard BEFORE UPDATE OF active ON collection_definitions
WHEN NEW.active = 0 AND EXISTS (
  SELECT 1 FROM collection_reference_uses u WHERE u.definition_id = OLD.id AND u.live = 1 AND u.required = 1
)
BEGIN SELECT RAISE(ABORT, 'Collection is required by published content'); END;
--> statement-breakpoint
CREATE TRIGGER page_reference_publish_guard AFTER UPDATE OF live_published_checkpoint_id ON pages
WHEN NEW.live_published_checkpoint_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.page_id = NEW.id AND u.live = 1 AND u.required = 1
    AND (r.published_revision_id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Required collection item is not published'); END;
--> statement-breakpoint
CREATE TRIGGER layout_reference_publish_guard AFTER UPDATE OF live_published_checkpoint_id ON layouts
WHEN NEW.live_published_checkpoint_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.layout_id = NEW.id AND u.live = 1 AND u.required = 1
    AND (r.published_revision_id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Required collection item is not published'); END;
--> statement-breakpoint
CREATE TRIGGER synced_reference_publish_guard AFTER UPDATE OF synced_published_data ON block_definitions
WHEN NEW.synced = 1 AND NEW.synced_published_data IS NOT NULL AND EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.block_definition_id = NEW.id AND u.live = 1 AND u.required = 1
    AND (r.published_revision_id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Required collection item is not published'); END;
--> statement-breakpoint
-- Service validation provides actionable errors; these checks close the race
-- with a concurrent record deletion after validation but before placement writes.
CREATE TRIGGER block_reference_insert_guard AFTER INSERT ON blocks
WHEN EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.block_id = NEW.id AND u.live = 0 AND u.record_id IS NOT NULL
    AND (r.id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Collection reference is missing or outside this scope'); END;
--> statement-breakpoint
CREATE TRIGGER block_reference_update_guard AFTER UPDATE OF content, type, page_id, layout_id ON blocks
WHEN EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.block_id = NEW.id AND u.live = 0 AND u.record_id IS NOT NULL
    AND (r.id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Collection reference is missing or outside this scope'); END;
