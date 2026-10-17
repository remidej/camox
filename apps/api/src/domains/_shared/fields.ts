import { pageTextLinkIds } from "../../lib/lexical-state";

/**
 * What each field of a stored content or settings schema is: its kind, its default, what its
 * value points at, and the schemas under it. Definitions reach the API as JSON synced by a
 * release, typed `unknown`; this module is the one place that reads that JSON. It reads the
 * stored schema, never the code-side field builders (ADR 0001).
 *
 * Stored schemas and content can be anything (ADR 0007), so nothing here throws: a schema
 * without fields has none, a field of an unknown kind is `Unknown`, and malformed options read
 * as absent.
 */

export type FieldKind =
  | "String"
  | "Artifact"
  | "Embed"
  | "Icon"
  | "Link"
  | "Boolean"
  | "Enum"
  | "Image"
  | "File"
  | "ImageList"
  | "FileList"
  | "Repeater"
  | "Reference"
  | "ReferenceList";

type FieldBase = {
  name: string;
  /** The title editors see, or the field's name. */
  title: string;
  /** The field's stored JSON Schema, for validation and the options this type doesn't name. */
  schema: Record<string, unknown>;
};

export type Field = FieldBase &
  (
    | { kind: "String" | "Artifact" | "Embed" | "Icon" | "Link" | "Boolean" }
    | { kind: "Enum"; options: string[] }
    | { kind: "Image" | "File"; required: boolean; accept: string[] | undefined }
    | { kind: "ImageList" | "FileList"; accept: string[] | undefined }
    | {
        kind: "Repeater";
        /** The content schema of the repeater's items. */
        itemContentSchema: unknown;
        /** The settings schema of the repeater's items, if they have settings. */
        itemSettingsSchema: unknown;
        /** How many items a new block starts with. */
        defaultItems: number;
      }
    | {
        kind: "Reference";
        collectionId: string;
        required: boolean;
        /** The content schema of the referenced collection's records. */
        recordSchema: unknown;
      }
    | {
        kind: "ReferenceList";
        collectionId: string;
        /** A query-backed list resolves its records in code and stores nothing. */
        queryBacked: boolean;
        maxItems: number | undefined;
        recordSchema: unknown;
      }
    | { kind: "Unknown" }
  );

const kinds = new Set<string>([
  "String",
  "Artifact",
  "Embed",
  "Icon",
  "Link",
  "Boolean",
  "Enum",
  "Image",
  "File",
  "ImageList",
  "FileList",
  "Repeater",
  "Reference",
  "ReferenceList",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringsOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** One field of a schema, from its stored JSON Schema. */
function fieldFrom(name: string, schema: Record<string, unknown>): Field {
  const base = { name, title: typeof schema.title === "string" ? schema.title : name, schema };
  const kind =
    typeof schema.fieldType === "string" && kinds.has(schema.fieldType)
      ? (schema.fieldType as FieldKind)
      : "Unknown";
  const itemSchema = isObject(schema.items) ? schema.items : undefined;
  switch (kind) {
    case "Enum":
      return { ...base, kind, options: stringsOf(schema.enum) ?? [] };
    case "Image":
    case "File":
      return {
        ...base,
        kind,
        required: schema.required === true,
        accept: stringsOf(schema.accept),
      };
    case "ImageList":
    case "FileList":
      return { ...base, kind, accept: stringsOf(itemSchema?.accept) };
    case "Repeater":
      return {
        ...base,
        kind,
        itemContentSchema: itemSchema,
        itemSettingsSchema: schema.itemSettingsSchema ?? undefined,
        defaultItems: numberOf(schema.defaultItems) ?? numberOf(schema.minItems) ?? 0,
      };
    case "Reference":
    case "ReferenceList": {
      // A reference that names no collection points nowhere: sync never stores one.
      if (typeof schema.collectionId !== "string" || schema.collectionId === "") {
        return { ...base, kind: "Unknown" };
      }
      const reference = { collectionId: schema.collectionId, recordSchema: schema.referenceSchema };
      if (kind === "Reference") {
        return { ...base, ...reference, kind, required: schema.required === true };
      }
      return {
        ...base,
        ...reference,
        kind,
        queryBacked: schema.query !== undefined,
        maxItems: numberOf(schema.maxItems),
      };
    }
    default:
      return { ...base, kind };
  }
}

/** One field of a content or settings schema, by name. */
export function fieldOf(schema: unknown, name: string): Field | undefined {
  if (!isObject(schema) || !isObject(schema.properties)) return undefined;
  if (!Object.hasOwn(schema.properties, name)) return undefined;
  return readField(schema.properties[name], name);
}

/** A field schema read on its own, wherever it sits, such as an asset list's single asset. */
export function readField(schema: unknown, name = ""): Field | undefined {
  return isObject(schema) ? fieldFrom(name, schema) : undefined;
}

/** The fields of a content or settings schema, in schema order. */
export function fieldsOf(schema: unknown): Field[] {
  if (!isObject(schema) || !isObject(schema.properties)) return [];
  return Object.entries(schema.properties).flatMap(([name, field]) =>
    isObject(field) ? [fieldFrom(name, field)] : [],
  );
}

const assetShapes: Partial<Record<string, "single" | "list">> = {
  Image: "single",
  File: "single",
  ImageList: "list",
  FileList: "list",
};

/** Whether a field kind holds one file (an image or a file), a list of them, or none. */
export function assetShape(kind: string | undefined): "single" | "list" | undefined {
  return kind === undefined || !Object.hasOwn(assetShapes, kind) ? undefined : assetShapes[kind];
}

/** Whether a field holds files: an image, a file, or a list of either. */
export function isAsset(
  field: Field,
): field is Extract<Field, { kind: "Image" | "File" | "ImageList" | "FileList" }> {
  return assetShape(field.kind) !== undefined;
}

/** A record field's value when it has nothing else: the empty value of its kind. */
function emptyRecordValue(field: Field): unknown {
  switch (field.kind) {
    case "Boolean":
      return false;
    case "Enum":
      return field.options[0] ?? "";
    case "Image":
    case "File":
    case "Reference":
      return null;
    case "ImageList":
    case "FileList":
    case "ReferenceList":
      return [];
    default:
      return "";
  }
}

/**
 * The value content gets for a field it doesn't hold, as a fresh copy.
 * - `block`: block, shared content and repeatable item content and settings. A field without
 *   a default gets nothing, and neither do assets, whose defaults are placeholders that only
 *   render, and repeaters, whose items are rows of their own.
 * - `record`: collection records hold every field. Asset placeholders never become record
 *   content, and a field without a default gets the empty value of its kind.
 */
export function defaultOf(field: Field, holder: "block"): { value: unknown } | undefined;
export function defaultOf(field: Field, holder: "record"): { value: unknown };
export function defaultOf(field: Field, holder: "block" | "record") {
  const declared = Object.hasOwn(field.schema, "default") && !isAsset(field);
  if (holder === "record") {
    return { value: declared ? structuredClone(field.schema.default) : emptyRecordValue(field) };
  }
  if (!declared || field.kind === "Repeater") return undefined;
  return { value: structuredClone(field.schema.default) };
}

/** What a field's value points at: a collection record, a file, or a page. */
export type Pointer =
  | { to: "record"; collectionId: string; id: string }
  | { to: "file"; id: string }
  | { to: "page"; id: string };

/** An id as content stores it in a place that points; anything else points nowhere. */
function idOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function fileIdOf(value: unknown) {
  return isObject(value) ? idOf(value._fileId) : undefined;
}

function idsOf(field: Field, value: unknown): string[] {
  switch (field.kind) {
    case "Reference":
    case "Image":
    case "File":
      return [(field.kind === "Reference" ? idOf : fileIdOf)(value)].filter(
        (id) => id !== undefined,
      );
    case "ReferenceList":
      if (field.queryBacked || !Array.isArray(value)) return [];
      return value.map(idOf).filter((id) => id !== undefined);
    case "ImageList":
    case "FileList":
      return Array.isArray(value) ? value.map(fileIdOf).filter((id) => id !== undefined) : [];
    case "Link": {
      if (!isObject(value) || value.type !== "page") return [];
      const pageId = idOf(value.pageId);
      return pageId === undefined ? [] : [pageId];
    }
    case "String":
      return pageTextLinkIds(value);
    default:
      return [];
  }
}

/**
 * What a field's value points at, each once, in stored order. Only values in a place that
 * points count: a reference or a manual reference list's entries, a link to a page, page
 * links in rich text, and the `_fileId` of images and files. An id that doesn't exist, or
 * isn't a valid id at all, is still a pointer: checks report it as dangling. Repeatable items
 * hold their own content, so a repeater points at nothing itself.
 */
export function pointersOf(field: Field, value: unknown): Pointer[] {
  const ids = [...new Set(idsOf(field, value))];
  if (field.kind === "Reference" || field.kind === "ReferenceList") {
    const { collectionId } = field;
    return ids.map((id) => ({ to: "record", collectionId, id }));
  }
  const to = isAsset(field) ? "file" : "page";
  return ids.map((id) => ({ to, id }));
}

/** What content points at, field by field in schema order. Stale keys point at nothing. */
export function pointersIn(
  schema: unknown,
  content: unknown,
): { field: Field; pointer: Pointer }[] {
  if (!isObject(content)) return [];
  return fieldsOf(schema).flatMap((field) =>
    pointersOf(field, content[field.name]).map((pointer) => ({ field, pointer })),
  );
}

/**
 * Adds every file id stored anywhere in `value` to `into`, without a schema: in fields the
 * definition no longer has, and in read shapes such as resolved references. It finds at least
 * every file `pointersIn` finds, and it is the definition the SQL in `references-to.ts` applies
 * to stored content.
 */
export function collectFileIds(value: unknown, into: Set<string>) {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) collectFileIds(entry, into);
    return;
  }
  const id = fileIdOf(value);
  if (id !== undefined) into.add(id);
  for (const [key, entry] of Object.entries(value)) {
    if (key !== "_fileId") collectFileIds(entry, into);
  }
}

type RepeaterField = Extract<Field, { kind: "Repeater" }>;

/** The schemas a repeatable item is read by, from the repeater holding it. */
export type ItemSchemas = { repeater: RepeaterField; content: unknown; settings: unknown };

/**
 * Each repeatable item's schemas, found by walking its repeater path from its block's content
 * schema (or its synced definition's). An item whose repeater or parent is gone, or whose
 * parents form a cycle, has none and is left out.
 */
export function itemSchemas(
  rootSchema: unknown,
  items: readonly { id: string; parentItemId: string | null; fieldName: string }[],
): Map<string, ItemSchemas> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const found = new Map<string, ItemSchemas | null>();
  const schemasOf = (item: (typeof items)[number], seen: Set<string>): ItemSchemas | null => {
    const known = found.get(item.id);
    if (known !== undefined) return known;
    if (seen.has(item.id)) return null;
    seen.add(item.id);
    const parent = item.parentItemId === null ? undefined : byId.get(item.parentItemId);
    const container =
      item.parentItemId === null ? rootSchema : parent && schemasOf(parent, seen)?.content;
    const field = fieldsOf(container).find((f) => f.name === item.fieldName);
    const schemas =
      field?.kind === "Repeater"
        ? { repeater: field, content: field.itemContentSchema, settings: field.itemSettingsSchema }
        : null;
    found.set(item.id, schemas);
    return schemas;
  };
  const result = new Map<string, ItemSchemas>();
  for (const item of items) {
    const schemas = schemasOf(item, new Set());
    if (schemas) result.set(item.id, schemas);
  }
  return result;
}

/**
 * Whether a field takes a file: one of its `accept` entries matches the file's MIME type
 * (exactly, or `type/*`) or its extension (`.ext`), ignoring case. A field naming no accepted
 * types takes any file.
 */
export function accepts(field: Field, file: { mimeType: string; filename: string }) {
  const accept = isAsset(field) ? field.accept : undefined;
  if (!accept?.length) return true;
  const mimeType = file.mimeType.toLowerCase();
  const filename = file.filename.toLowerCase();
  return accept.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (entry === "*" || entry === "*/*") return true;
    if (entry.startsWith(".")) return filename.endsWith(entry);
    if (entry.endsWith("/*")) return mimeType.startsWith(entry.slice(0, -1));
    return mimeType === entry;
  });
}
