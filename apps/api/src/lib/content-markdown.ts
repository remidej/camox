import type { ResolvedReferences } from "../domains/collections/references";
import { transformImageUrl } from "./image-transform";
import { lexicalStateToPlainText } from "./lexical-state";

type ResolvedFile = { url: string; alt: string; filename: string; mimeType: string };

type SettingsContext = {
  settings?: Record<string, unknown> | null;
  itemSettings?: Record<string, unknown> | null;
  files?: Map<number, ResolvedFile> | null;
  references?: ResolvedReferences;
};

export function contentToMarkdown(
  toMarkdown: readonly string[],
  schemaProperties: Record<string, any>,
  content: Record<string, unknown>,
  options: { insideList?: boolean } & SettingsContext = {},
): string {
  const { insideList = false, settings, itemSettings, files, references } = options;
  const parts: string[] = [];

  for (const line of toMarkdown) {
    const withoutConds = evaluateConditionals(line, { settings, itemSettings, files });
    if (withoutConds === null) continue;
    const resolved = resolveLine(withoutConds, schemaProperties, content, {
      settings,
      itemSettings,
      files,
      references,
    });
    if (resolved !== null) parts.push(resolved);
  }

  return parts.join(insideList ? "\n" : "\n\n");
}

/**
 * Evaluate `{{#if settings.X}}...{{/if}}` and `{{#if (eq settings.X "v")}}...{{/if}}` blocks
 * against the provided settings/itemSettings context. Returns the line with matching blocks
 * inlined and falsy blocks removed, or `null` if the whole line resolves to empty.
 *
 * Supports nested blocks by iterating inner-to-outer.
 */
const IF_BLOCK_RE =
  /\{\{#if (?:(settings|itemSettings)\.(\w+)|\(eq (settings|itemSettings)\.(\w+) "([^"]*)"\))\}\}((?:(?!\{\{#if ).)*?)\{\{\/if\}\}/s;

function evaluateConditionals(line: string, ctx: SettingsContext): string | null {
  let current = line;
  while (true) {
    const match = IF_BLOCK_RE.exec(current);
    if (!match) break;
    const [full, boolRoot, boolName, enumRoot, enumName, enumValue, body] = match;

    const root = boolRoot ?? enumRoot;
    const name = boolName ?? enumName;
    const source = root === "settings" ? ctx.settings : ctx.itemSettings;
    const value = source?.[name];

    const matched = enumValue === undefined ? Boolean(value) : value === enumValue;
    current =
      current.slice(0, match.index) +
      (matched ? body : "") +
      current.slice(match.index + full.length);
  }
  if (current === "") return null;
  return current;
}

const PLACEHOLDER_RE = /\{\{(\w+(?:\.\w+)*)\}\}/g;

function resolveLine(
  line: string,
  schemaProperties: Record<string, any>,
  content: Record<string, unknown>,
  ctx: SettingsContext,
): string | null {
  const placeholders = [...line.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
  if (placeholders.length === 0) return line;

  const resolve = (key: string) => {
    const [root, field, ...nested] = key.split(".");
    if (!field && schemaProperties[root]?.fieldType === "ReferenceList") {
      return resolveReferenceList(schemaProperties[root], ctx.references?.[root], ctx);
    }
    if (!field) return resolveField(schemaProperties[root], content[root], ctx);
    if (nested.length) return undefined;
    const reference = ctx.references?.[root];
    if (!reference || Array.isArray(reference)) return undefined;
    const properties = (reference.contentSchema as { properties?: Record<string, unknown> })
      ?.properties;
    return resolveField(properties?.[field], reference.content[field], ctx);
  };
  const resolvedValues = placeholders.map(resolve);
  if (resolvedValues.every((v) => !v)) return null;

  return line.replace(PLACEHOLDER_RE, (_match, key: string) => {
    return resolve(key) ?? "";
  });
}

/**
 * Render a reference list's resolved records (already ordered, and limited to published
 * ones for live reads) as a bulleted list, one item per record via the per-use
 * `toMarkdown`. Without one, each record falls back to its label.
 */
function resolveReferenceList(
  schema: { toMarkdown?: readonly string[] },
  records: ResolvedReferences[string] | undefined,
  ctx: SettingsContext,
): string | undefined {
  if (!Array.isArray(records)) return undefined;
  const itemParts: string[] = [];
  for (const record of records) {
    const properties = (record.contentSchema as { properties?: Record<string, unknown> })
      ?.properties;
    const md = schema.toMarkdown
      ? contentToMarkdown(schema.toMarkdown, properties ?? {}, record.content, {
          insideList: true,
          files: ctx.files,
        })
      : record.label;
    if (md) itemParts.push(toListItem(md));
  }
  return itemParts.length > 0 ? itemParts.join("\n") : undefined;
}

function toListItem(markdown: string): string {
  const lines = markdown.split("\n");
  return [`- ${lines[0]}`, ...lines.slice(1).map((l) => `  ${l}`)].join("\n");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Asset fields are stored as `{ _fileId }` markers; resolve them against the
 * files map. Falls back to whatever inline shape the value already has.
 */
function resolveAsset(value: unknown, files: SettingsContext["files"]): ResolvedFile {
  if (value && typeof value === "object" && "_fileId" in value) {
    const id = (value as { _fileId: unknown })._fileId;
    if (typeof id === "number") {
      const file = files?.get(id);
      if (file) return file;
    }
  }
  const v = (value ?? {}) as Record<string, unknown>;
  return {
    url: asString(v.url),
    alt: asString(v.alt),
    filename: asString(v.filename),
    mimeType: asString(v.mimeType),
  };
}

function resolveField(schema: any, value: unknown, ctx: SettingsContext): string | undefined {
  if (value == null) return undefined;
  const fieldType: string | undefined = schema?.fieldType;

  if (fieldType === "String") {
    const text = lexicalStateToPlainText(value as string | Record<string, unknown>);
    if (!text) return undefined;
    return text;
  }

  if (fieldType === "Link") {
    const link = value as Record<string, unknown>;
    const text = asString(link.text);
    const pageId = asString(link.pageId);
    const href = pageId ? `camox:page:${pageId}` : asString(link.href);
    if (!text && !href) return undefined;
    return `[${text}](${href})`;
  }

  if (fieldType === "Image") {
    const { url, alt, mimeType } = resolveAsset(value, ctx.files);
    if (!url) return undefined;
    return `![${alt}](${transformImageUrl(url, { mimeType })})`;
  }

  if (fieldType === "File") {
    const { url, filename } = resolveAsset(value, ctx.files);
    if (!url && !filename) return undefined;
    return `[${filename}](${url})`;
  }

  if (fieldType === "Embed") {
    const url = asString(value);
    return url || undefined;
  }

  if (fieldType === "ImageList" || fieldType === "FileList") {
    if (!Array.isArray(value)) return undefined;
    const leafSchema = schema?.items;
    if (!leafSchema) return undefined;
    const itemParts: string[] = [];
    for (const v of value) {
      const md = resolveField(leafSchema, v, {
        settings: ctx.settings,
        itemSettings: null,
        files: ctx.files,
      });
      if (md) itemParts.push(`- ${md}`);
    }
    return itemParts.length > 0 ? itemParts.join("\n") : undefined;
  }

  if (fieldType === "Repeater") {
    if (!Array.isArray(value)) return undefined;
    const itemSchema = schema?.items?.properties;
    if (!itemSchema) return undefined;

    const itemToMarkdown: readonly string[] | undefined = schema?.toMarkdown;

    const itemParts: string[] = [];
    for (const item of value) {
      const isDbShape = item && typeof item === "object" && "content" in item;
      const itemContent = isDbShape ? (item as any).content : item;
      const itemSettings =
        isDbShape && "settings" in item
          ? (((item as any).settings as Record<string, unknown> | null | undefined) ?? null)
          : null;
      // Items resolve their own references, like blocks do.
      const itemReferences = isDbShape
        ? (item as { references?: ResolvedReferences }).references
        : undefined;
      if (!itemContent || typeof itemContent !== "object") continue;

      let md: string;
      if (itemToMarkdown) {
        md = contentToMarkdown(itemToMarkdown, itemSchema, itemContent as Record<string, unknown>, {
          insideList: true,
          settings: ctx.settings,
          itemSettings,
          files: ctx.files,
          references: itemReferences,
        });
      } else {
        const fieldParts: string[] = [];
        for (const key of Object.keys(itemSchema)) {
          const resolved = resolveField(
            itemSchema[key],
            (itemContent as Record<string, unknown>)[key],
            { settings: ctx.settings, itemSettings, files: ctx.files },
          );
          if (resolved) fieldParts.push(resolved);
        }
        md = fieldParts.join(" — ");
      }
      if (!md) continue;
      itemParts.push(toListItem(md));
    }
    return itemParts.length > 0 ? itemParts.join("\n") : undefined;
  }

  if (fieldType === "Boolean" || fieldType === "Enum") {
    if (typeof value === "boolean" || typeof value === "string" || typeof value === "number") {
      return String(value);
    }
    return undefined;
  }

  return undefined;
}
