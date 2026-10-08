-- Collection records join the dependency index as placements: each record's draft and its
-- current published revision, read against the schema it was written with. Deleting a
-- record that any record draft or live revision links is refused, like block placements.
-- Guard triggers read the uses view by name at run time, so they stay unchanged.
DROP VIEW collection_reference_uses;
--> statement-breakpoint
DROP VIEW collection_reference_placements;
--> statement-breakpoint
CREATE VIEW collection_reference_record_placements AS
SELECT d.project_id, d.environment_id, d.content_schema, r.draft AS content, 0 AS live,
  NULL AS page_id, NULL AS layout_id, NULL AS block_id, NULL AS block_definition_id,
  r.id AS source_record_id
FROM collection_records r JOIN collection_definitions d ON d.id = r.definition_id
UNION ALL
SELECT d.project_id, d.environment_id, json_extract(v.definition, '$.contentSchema'),
  v.content, 1, NULL, NULL, NULL, NULL, r.id
FROM collection_records r
JOIN collection_revisions v ON v.id = r.published_revision_id
JOIN collection_definitions d ON d.id = r.definition_id;
--> statement-breakpoint
CREATE VIEW collection_reference_placements AS
SELECT *, NULL AS source_record_id FROM collection_reference_block_placements
UNION ALL
SELECT *, NULL AS source_record_id FROM collection_reference_item_placements
UNION ALL
SELECT * FROM collection_reference_record_placements;
--> statement-breakpoint
CREATE VIEW collection_reference_uses AS
SELECT p.project_id, p.environment_id, d.id AS definition_id, v.value AS record_id,
  p.live, p.page_id, p.layout_id, p.block_id, p.block_definition_id, p.source_record_id,
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
  p.live, p.page_id, p.layout_id, p.block_id, p.block_definition_id, p.source_record_id,
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
-- Record writes get the same missing-record race guard as block and item writes.
CREATE TRIGGER collection_record_reference_insert_guard AFTER INSERT ON collection_records
WHEN EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.source_record_id = NEW.id AND u.live = 0 AND u.record_id IS NOT NULL
    AND (r.id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Collection reference is missing or outside this scope'); END;
--> statement-breakpoint
CREATE TRIGGER collection_record_reference_update_guard AFTER UPDATE OF draft ON collection_records
WHEN EXISTS (
  SELECT 1 FROM collection_reference_uses u
  LEFT JOIN collection_records r ON r.id = u.record_id AND r.definition_id = u.definition_id
  LEFT JOIN collection_definitions d ON d.id = u.definition_id
  WHERE u.source_record_id = NEW.id AND u.live = 0 AND u.record_id IS NOT NULL
    AND (r.id IS NULL OR d.active IS NOT 1)
)
BEGIN SELECT RAISE(ABORT, 'Collection reference is missing or outside this scope'); END;
