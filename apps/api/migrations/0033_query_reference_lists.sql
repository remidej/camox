-- Query-backed reference lists are resolved content, not placements: a list field whose
-- schema carries a `query` never enters the dependency index, even if a value was stored
-- before the list became query-backed. They never block deleting or unpublishing a record,
-- and never mark a page or layout Modified.
-- Guard triggers read the uses view by name at run time, so they stay unchanged.
DROP VIEW collection_reference_uses;
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
WHERE json_extract(f.value, '$.fieldType') = 'ReferenceList'
  AND json_type(f.value, '$.query') IS NULL;
