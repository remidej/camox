import { uuidv7Schema } from "@camox/api-contract/ids";
import { z } from "zod";

/**
 * Rewrite Image/File nodes in a block contentSchema to the AI-facing shape:
 * `{ _fileId: <UUIDv7> } | null`. The persisted SDK schema bakes in
 * `default: { url: "https://placehold.co/...", ... }` to drive runtime UI
 * placeholders — but when handed verbatim to a model it trains the model to
 * mimic the placehold URL into block content. This rewriter strips those
 * defaults from any AI-facing surface and replaces the asset shape with a
 * marker the server will accept (a `_fileId` reference, or null which the
 * frontend renders as a placeholder on its own).
 *
 * Pure: returns a new tree, never mutates input.
 */

type SchemaNode = Record<string, unknown>;

const { $schema: _, ...fileIdSchema } = z.toJSONSchema(uuidv7Schema);

function isObject(v: unknown): v is SchemaNode {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function rewriteAssetNode(node: SchemaNode): SchemaNode {
  const fieldType = node.fieldType as "Image" | "File";
  const out: SchemaNode = {
    fieldType,
    anyOf: [
      {
        type: "object",
        properties: { _fileId: fileIdSchema },
        required: ["_fileId"],
        additionalProperties: false,
      },
      { type: "null" },
    ],
    description:
      "Reference to a file in the project's files table. Either { _fileId: <the file's UUIDv7 id> } pointing at an existing file row, or null (the frontend renders a placeholder). Do NOT invent a URL or filename — a _fileId that isn't a UUIDv7 is rejected, and any other shape is silently dropped on write.",
  };
  if (typeof node.title === "string") out.title = node.title;
  return out;
}

export function rewriteAssetSchema(schema: unknown): unknown {
  if (!isObject(schema)) return schema;

  if (schema.fieldType === "Image" || schema.fieldType === "File") {
    return rewriteAssetNode(schema);
  }

  if (schema.type === "array" && "items" in schema) {
    return { ...schema, items: rewriteAssetSchema(schema.items) };
  }

  if (schema.type === "object" && isObject(schema.properties)) {
    const rewrittenProperties: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      rewrittenProperties[k] = rewriteAssetSchema(v);
    }
    return { ...schema, properties: rewrittenProperties };
  }

  return schema;
}
