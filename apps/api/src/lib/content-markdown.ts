import { artifactTitle } from "@camox/api-contract";

import { assetShape, fieldsOf, pointersOf, readField } from "../domains/_shared/fields";
import type { ResolvedReferences } from "../domains/content/reader";
import { transformImageUrl } from "./image-transform";
import { lexicalStateToPlainText } from "./lexical-state";

type ResolvedFile = { url: string; alt: string; filename: string; mimeType: string };

type SettingsContext = {
  settings?: Record<string, unknown> | null;
  itemSettings?: Record<string, unknown> | null;
  files?: ReadonlyMap<string, ResolvedFile> | null;
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

// A Markdown link or image, which plain text reads by its text or alt text.
const MARKDOWN_LINK = /!?\[([^\]]*)\]\([^)]*\)/g;

/**
 * One template line as plain text, the way Markdown templates fill it: links read as their
 * text and images as their alt text. Empty when every token in it is.
 */
export function contentToPlainText(
  line: string,
  schemaProperties: Record<string, any>,
  content: Record<string, unknown>,
  options: SettingsContext = {},
): string {
  return contentToMarkdown([line], schemaProperties, content, options).replace(MARKDOWN_LINK, "$1");
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
    const [root, ...path] = key.split(".");
    if (!path.length && readField(schemaProperties[root])?.kind === "ReferenceList") {
      return resolveReferenceList(schemaProperties[root], ctx.references?.[root], ctx);
    }
    if (!path.length) return resolveField(schemaProperties[root], content[root], ctx);
    // Walk single references (`article.author.name`) through each record's resolved links.
    let record = ctx.references?.[root];
    for (const [index, field] of path.entries()) {
      if (!record || Array.isArray(record)) return undefined;
      const properties = (record.contentSchema as { properties?: Record<string, any> })?.properties;
      if (index < path.length - 1) {
        record = record.references?.[field];
        continue;
      }
      if (readField(properties?.[field])?.kind === "ReferenceList") {
        return resolveReferenceList(properties![field], record.references?.[field], ctx);
      }
      return resolveField(properties?.[field], record.content[field], ctx);
    }
    return undefined;
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
 * `toMarkdown`. Without one, each record falls back to its title.
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
          references: record.references,
        })
      : record.title;
    if (md) itemParts.push(toListItem(md));
  }
  return itemParts.length > 0 ? itemParts.join("\n") : undefined;
}

function toListItem(markdown: string): string {
  const lines = markdown.split("\n");
  return [`- ${lines[0]}`, ...lines.slice(1).map((l) => `  ${l}`)].join("\n");
}

/** An artifact's Markdown Representation is its title; its source stays opaque (ADR 0002). */
function artifactMarkdown(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return artifactTitle(value);
}

/**
 * `content` with every artifact source, including those in repeatable items, replaced by its
 * Markdown Representation. Fallbacks that serialize raw content for an LLM use it so that
 * artifact sources are never sent.
 */
export function stripArtifactSources(
  schemaProperties: Record<string, any> | null | undefined,
  content: Record<string, unknown>,
): Record<string, unknown> {
  if (!schemaProperties) return content;
  const result = { ...content };
  for (const field of fieldsOf({ properties: schemaProperties })) {
    const value = content[field.name];
    if (field.kind === "Artifact") {
      if (typeof value === "string") result[field.name] = artifactMarkdown(value) ?? "";
      continue;
    }
    if (field.kind !== "Repeater" || !Array.isArray(value)) continue;
    const itemProperties = (field.itemContentSchema as { properties?: Record<string, any> })
      ?.properties;
    result[field.name] = value.map((item) => stripItemArtifactSources(itemProperties, item));
  }
  return result;
}

function stripItemArtifactSources(itemProperties: Record<string, any> | undefined, item: unknown) {
  if (!item || typeof item !== "object") return item;
  // DB-backed items hold their fields under `content`; inline items are the content itself.
  const record = item as Record<string, unknown>;
  if (record.content && typeof record.content === "object" && !Array.isArray(record.content)) {
    return {
      ...record,
      content: stripArtifactSources(itemProperties, record.content as Record<string, unknown>),
    };
  }
  return stripArtifactSources(itemProperties, record);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Asset fields are stored as `{ _fileId }` markers; resolve them against the
 * files map. A value that already carries its URL (a collection record's asset
 * snapshot) keeps its own metadata.
 */
function resolveAsset(value: unknown, files: SettingsContext["files"]): ResolvedFile {
  const inline = typeof (value as { url?: unknown } | null)?.url === "string";
  if (!inline && value && typeof value === "object" && "_fileId" in value) {
    const id = (value as { _fileId: unknown })._fileId;
    if (typeof id === "string") {
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
  const field = readField(schema);
  const kind = field?.kind;

  if (kind === "String") {
    const text = lexicalStateToPlainText(value as string | Record<string, unknown>);
    if (!text) return undefined;
    return text;
  }

  if (kind === "Link") {
    const link = value as Record<string, unknown>;
    const text = asString(link.text);
    const [page] = pointersOf(field!, value);
    const href = page ? `camox:page:${page.id}` : asString(link.href);
    if (!text && !href) return undefined;
    return `[${text}](${href})`;
  }

  if (kind === "Image") {
    const { url, alt, mimeType } = resolveAsset(value, ctx.files);
    if (!url) return undefined;
    return `![${alt}](${transformImageUrl(url, { mimeType })})`;
  }

  if (kind === "File") {
    const { url, filename } = resolveAsset(value, ctx.files);
    if (!url && !filename) return undefined;
    return `[${filename}](${url})`;
  }

  if (kind === "Embed") {
    const url = asString(value);
    return url || undefined;
  }

  if (kind === "Artifact") return artifactMarkdown(value);

  if (field && assetShape(kind) === "list") {
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

  if (kind === "Repeater") {
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

  if (kind === "Boolean" || kind === "Enum") {
    if (typeof value === "boolean" || typeof value === "string" || typeof value === "number") {
      return String(value);
    }
    return undefined;
  }

  return undefined;
}
