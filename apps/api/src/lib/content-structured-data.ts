import {
  type EvaluatedNode,
  isSettingCondition,
  type SettingCondition,
  type StructuredDataValue,
} from "@camox/api-contract";

import { pointersOf, readField } from "../domains/_shared/fields";
import type { ResolvedReference, ResolvedReferences } from "../domains/content/reader";
import { contentToPlainText } from "./content-markdown";
import { transformedImage } from "./image-transform";
import { lexicalStateToPlainText } from "./lexical-state";

// Blocks' and repeatable items' `toStructuredData` templates are JSON whose strings may hold
// field tokens (`{{name}}`), as the SDK serializes them. A string that is one token alone takes
// the field's value as structured data; tokens within longer text read as plain text, as titles
// do. What resolves to nothing is left out.

/** A file a template's image or file token places, as the scope reads it. */
export type StructuredDataFile = {
  url: string;
  alt: string;
  filename: string;
  mimeType: string;
  size: number | null;
  width: number | null;
  height: number | null;
};

/** What a template is evaluated with, beside the content it reads. */
export type StructuredDataContext = {
  settings?: Record<string, unknown> | null;
  itemSettings?: Record<string, unknown> | null;
  files: ReadonlyMap<string, StructuredDataFile>;
  references?: ResolvedReferences;
  /** The value a link to a page of the website takes, by the page's id; none when it's gone. */
  pageUrl: (pageId: string) => StructuredDataValue | undefined;
  /**
   * The value a reference to a record takes: a link to its node, or its title when its collection
   * has no Structured Data. Without it, references are left out.
   */
  record?: (record: ResolvedReference) => StructuredDataValue | undefined;
};

type Value = StructuredDataValue | undefined;

const TOKEN = /^\{\{(\w+(?:\.\w+)*)\}\}$/;
const HAS_TOKEN = /\{\{\w+(?:\.\w+)*\}\}/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The nodes a template gives for content: the node it returns, or each node of the list it
 * returns, with repeatable items' nodes in place of their repeater's token.
 */
export function contentToStructuredData(
  template: unknown,
  schemaProperties: Record<string, unknown>,
  content: Record<string, unknown>,
  ctx: StructuredDataContext,
): EvaluatedNode[] {
  const evaluated = evaluate(template, schemaProperties, content, ctx);
  return (Array.isArray(evaluated) ? evaluated : [evaluated]).filter(isObject) as EvaluatedNode[];
}

function evaluate(
  template: unknown,
  properties: Record<string, unknown>,
  content: Record<string, unknown>,
  ctx: StructuredDataContext,
): Value {
  if (typeof template === "string") return evaluateString(template, properties, content, ctx);
  if (isSettingCondition(template)) {
    return holds(template, ctx) ? evaluate(template.show, properties, content, ctx) : undefined;
  }
  if (Array.isArray(template)) {
    const values = template.flatMap((entry) => {
      const value = evaluate(entry, properties, content, ctx);
      // A repeater's token, or a list shown under a setting, adds its entries to the list.
      if (Array.isArray(value) && (typeof entry === "string" || isSettingCondition(entry)))
        return value;
      return value === undefined ? [] : [value];
    });
    return values.length > 0 ? values : undefined;
  }
  if (isObject(template)) {
    const node: Record<string, StructuredDataValue> = {};
    for (const [key, entry] of Object.entries(template)) {
      const value = evaluate(entry, properties, content, ctx);
      if (value !== undefined) node[key] = value;
    }
    return node;
  }
  if (typeof template === "number" || typeof template === "boolean") return template;
  return undefined;
}

/** Whether the setting a part of a template is shown under holds: on, or equal to its value. */
function holds({ setting, equals }: SettingCondition, ctx: StructuredDataContext) {
  const [root, name] = setting.split(".") as ["settings" | "itemSettings", string];
  const value = (root === "settings" ? ctx.settings : ctx.itemSettings)?.[name];
  return equals === undefined ? Boolean(value) : value === equals;
}

function evaluateString(
  template: string,
  properties: Record<string, unknown>,
  content: Record<string, unknown>,
  ctx: StructuredDataContext,
): Value {
  const token = TOKEN.exec(template)?.[1];
  if (token !== undefined) return resolveToken(token, properties, content, ctx);
  if (!HAS_TOKEN.test(template)) return template;
  const text = contentToPlainText(template, properties, content, ctx);
  return text || undefined;
}

/** A token alone: its field's value, through single references for a dotted path. */
function resolveToken(
  key: string,
  properties: Record<string, unknown>,
  content: Record<string, unknown>,
  ctx: StructuredDataContext,
): Value {
  const [root, ...path] = key.split(".");
  if (path.length === 0) {
    const kind = readField(properties[root!])?.kind;
    if (kind === "Reference" || kind === "ReferenceList") return referenced(root!, ctx);
    return resolveField(properties[root!], content[root!], ctx);
  }
  // A field of a referenced record reads as its value.
  let record = ctx.references?.[root!];
  for (const [index, field] of path.entries()) {
    if (!record || Array.isArray(record)) return undefined;
    if (index < path.length - 1) {
      record = record.references?.[field];
      continue;
    }
    const recordProperties = (record.contentSchema as { properties?: Record<string, unknown> })
      ?.properties;
    const recordCtx = { ...ctx, references: record.references };
    const kind = readField(recordProperties?.[field])?.kind;
    if (kind === "Reference" || kind === "ReferenceList") return referenced(field, recordCtx);
    return resolveField(recordProperties?.[field], record.content[field], recordCtx);
  }
  return undefined;
}

/** A reference field's records as links or titles: one for a reference, a list for a list. */
function referenced(name: string, ctx: StructuredDataContext): Value {
  const resolved = ctx.references?.[name];
  const valueOf = ctx.record;
  if (!resolved || !valueOf) return undefined;
  if (!Array.isArray(resolved)) return valueOf(resolved);
  const values = resolved.flatMap((record) => valueOf(record) ?? []);
  return values.length > 0 ? values : undefined;
}

function resolveField(schema: unknown, value: unknown, ctx: StructuredDataContext): Value {
  if (value == null) return undefined;
  const field = readField(schema);
  switch (field?.kind) {
    case "String":
      return lexicalStateToPlainText(value as string | Record<string, unknown>) || undefined;
    case "Embed":
      return typeof value === "string" && value ? value : undefined;
    case "Link": {
      const [page] = pointersOf(field, value);
      if (page) return ctx.pageUrl(page.id);
      const href = (value as { href?: unknown }).href;
      return typeof href === "string" && href ? href : undefined;
    }
    case "File":
      return assetOf(value, ctx)?.url || undefined;
    case "Image": {
      const file = assetOf(value, ctx);
      if (!file?.url) return undefined;
      const image = transformedImage(file);
      return {
        "@type": "ImageObject",
        url: image.url,
        contentUrl: image.url,
        ...(image.width !== undefined && { width: image.width, height: image.height! }),
        ...(file.alt && { caption: file.alt }),
      };
    }
    case "Repeater":
      return repeatedNodes(schema, value, ctx);
    default:
      // Icons, artifacts and lists of files aren't Structured Data.
      return undefined;
  }
}

/** A repeater's items as their template's nodes, in order. None without a template. */
function repeatedNodes(schema: unknown, value: unknown, ctx: StructuredDataContext): Value {
  const template = isObject(schema) ? schema.toStructuredData : undefined;
  const itemProperties = isObject(schema) && isObject(schema.items) ? schema.items.properties : {};
  if (template === undefined || !Array.isArray(value)) return undefined;
  const nodes = value.flatMap((item) => {
    if (!isObject(item) || !isObject(item.content)) return [];
    return contentToStructuredData(
      template,
      isObject(itemProperties) ? itemProperties : {},
      item.content,
      {
        ...ctx,
        itemSettings: (item.settings as Record<string, unknown> | null | undefined) ?? null,
        references: item.references as ResolvedReferences | undefined,
      },
    );
  });
  return nodes.length > 0 ? nodes : undefined;
}

/** An asset field's file: the scope's file it names, or the snapshot it holds. */
function assetOf(value: unknown, ctx: StructuredDataContext): StructuredDataFile | undefined {
  if (!isObject(value)) return undefined;
  // Records' assets are snapshots of their files; the read's files have their dimensions too.
  const file = typeof value._fileId === "string" ? ctx.files.get(value._fileId) : undefined;
  if (file || typeof value.url !== "string") return file;
  return {
    url: value.url,
    alt: typeof value.alt === "string" ? value.alt : "",
    filename: typeof value.filename === "string" ? value.filename : "",
    mimeType: typeof value.mimeType === "string" ? value.mimeType : "",
    size: typeof value.size === "number" ? value.size : null,
    width: null,
    height: null,
  };
}
