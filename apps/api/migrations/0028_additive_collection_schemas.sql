DROP TRIGGER collection_schema_guard;
--> statement-breakpoint
-- Existing field contracts are immutable. Additions are allowed only after
-- every draft has been backfilled in the same transaction as the schema sync.
-- This also closes the race with creating a collection's first record.
CREATE TRIGGER collection_schema_guard BEFORE UPDATE OF content_schema ON collection_definitions
WHEN OLD.content_schema != NEW.content_schema
AND EXISTS (SELECT 1 FROM collection_records WHERE definition_id = OLD.id)
AND (
  EXISTS (
    SELECT 1 FROM json_each(OLD.content_schema, '$.properties') AS previous
    LEFT JOIN json_each(NEW.content_schema, '$.properties') AS incoming
      ON incoming.key = previous.key
    WHERE incoming.key IS NULL OR incoming.value != previous.value
  )
  OR EXISTS (
    SELECT 1 FROM collection_records AS record,
      json_each(NEW.content_schema, '$.properties') AS field
    WHERE record.definition_id = OLD.id
    AND NOT EXISTS (
      SELECT 1 FROM json_each(record.draft) AS content WHERE content.key = field.key
    )
  )
)
BEGIN SELECT RAISE(ABORT, 'Collection schema changes require compatible draft backfills'); END;
