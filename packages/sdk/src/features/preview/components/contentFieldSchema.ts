import type { FieldType } from "@/core/lib/fieldTypes";

/** The parts of a content field's JSON schema that the page editor sidebar reads. */
export type ContentFieldSchema = {
  fieldType?: FieldType;
  title?: string;
  /** Reference fields: the collection whose records they link. */
  collectionId?: string;
  /** Query-backed reference lists: the query whose results they list. */
  query?: unknown;
  /** File fields: accepted MIME types (list fields keep them on `items`). */
  accept?: string[];
  items?: { accept?: string[] };
};

type ContentSchema = { properties?: Record<string, ContentFieldSchema> };

/** Reads one field's schema from a block, repeater item or collection content schema. */
export function contentFieldSchema(
  schema: unknown,
  fieldName: string,
): ContentFieldSchema | undefined {
  return (schema as ContentSchema | null | undefined)?.properties?.[fieldName];
}
