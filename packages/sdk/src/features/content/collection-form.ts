import { isLexicalState, lexicalStateToPlainText } from "@/core/lib/lexicalState";

export type FieldSchema = {
  fieldType: "String" | "Embed" | "Enum" | "Boolean" | "Image" | "File" | "ImageList" | "FileList";
  title?: string;
  default?: unknown;
  enum?: string[];
  enumLabels?: Record<string, string>;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  accept?: string[];
  items?: { accept?: string[] };
};

export function collectionFormFields(contentSchema: unknown, label: string) {
  const schema = contentSchema as { properties: Record<string, FieldSchema> };
  return Object.entries(schema.properties).sort(
    ([a], [b]) => Number(b === label) - Number(a === label),
  );
}

export function collectionFormDefaults(
  fields: [string, FieldSchema][],
  content: Record<string, unknown> = {},
): Record<string, unknown> {
  return Object.fromEntries(
    fields.map(([name, schema]) => {
      // Asset schema defaults are preview-only, never authored form data.
      if (schema.fieldType === "Image" || schema.fieldType === "File") {
        return [name, editorAsset(content[name])];
      }
      if (schema.fieldType.endsWith("List")) {
        const assets = content[name];
        return [name, Array.isArray(assets) ? assets.map(editorAsset) : []];
      }
      const value = content[name] ?? schema.default;
      if (schema.fieldType === "String" && isLexicalState(value)) {
        return [name, lexicalStateToPlainText(value as string | Record<string, unknown>)];
      }
      if (value !== undefined) return [name, value];
      if (schema.fieldType === "Boolean") return [name, false];
      if (schema.fieldType === "Enum") return [name, schema.enum?.[0] ?? ""];
      return [name, ""];
    }),
  );
}

function editorAsset(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const asset = value as Record<string, unknown>;
  return { ...asset, ...(asset._fileId != null ? { _fileId: Number(asset._fileId) } : {}) };
}

function serializeAsset(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const asset = value as Record<string, unknown>;
  // Editors include library/upload metadata. Only send the collection asset snapshot shape.
  return {
    url: asset.url,
    alt: asset.alt ?? "",
    filename: asset.filename,
    mimeType: asset.mimeType,
    ...(asset.size != null ? { size: asset.size } : {}),
    ...(typeof asset._fileId === "number" || typeof asset._fileId === "string"
      ? { _fileId: String(asset._fileId) }
      : {}),
  };
}

export function collectionFormContent(
  fields: [string, FieldSchema][],
  values: Record<string, unknown>,
  original: Record<string, unknown> = {},
) {
  return Object.fromEntries(
    fields.map(([name, schema]) => {
      const value = values[name];
      if (schema.fieldType.endsWith("List")) {
        return [name, Array.isArray(value) ? value.map(serializeAsset) : value];
      }
      if (schema.fieldType === "Image" || schema.fieldType === "File") {
        return [name, serializeAsset(value)];
      }
      // Do not flatten existing rich text when another field is edited.
      if (
        schema.fieldType === "String" &&
        isLexicalState(original[name]) &&
        value === lexicalStateToPlainText(original[name] as string | Record<string, unknown>)
      ) {
        return [name, original[name]];
      }
      return [name, value];
    }),
  );
}
