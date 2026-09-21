import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { and, eq, inArray, sql } from "drizzle-orm";
import { outdent } from "outdent";
import { z } from "zod";

import type { Database } from "../../db";
import { contentToMarkdown } from "../../lib/content-markdown";
import { blockDefinitions, blocks, files, pages, repeatableItems } from "../../schema";

// --- AI Executors ---

const SEO_STRIP_KEYS = new Set([
  "createdAt",
  "updatedAt",
  "position",
  "settings",
  "pageId",
  "blockId",
  "fieldName",
  "summary",
  "_fileId",
]);

function stripNonSeoFields(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SEO_STRIP_KEYS.has(key)) continue;
    if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? stripNonSeoFields(item as Record<string, unknown>)
          : item,
      );
    } else if (value && typeof value === "object") {
      result[key] = stripNonSeoFields(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function generatePageSeoFromAi(
  apiKey: string,
  options: {
    fullPath: string;
    blocks: { type: string; markdown: string }[];
    previousMetaTitle?: string | null;
    previousMetaDescription?: string | null;
  },
) {
  const stabilityBlock =
    options.previousMetaTitle || options.previousMetaDescription
      ? outdent`

      <previous_metadata>
        <metaTitle>${options.previousMetaTitle ?? ""}</metaTitle>
        <metaDescription>${options.previousMetaDescription ?? ""}</metaDescription>
      </previous_metadata>
      <stability_instruction>
        Metadata was previously generated for this page.
        Return the SAME metadata unless it is no longer accurate.
        Only change it if the page content has meaningfully changed.
      </stability_instruction>
    `
      : "";

  return await chat({
    adapter: createOpenRouterText("google/gemini-3-flash-preview", apiKey),
    outputSchema: z.object({
      metaTitle: z.string(),
      metaDescription: z.string(),
    }),
    messages: [
      {
        role: "user",
        content: outdent`
          <instruction>
            Generate SEO metadata for a web page.
          </instruction>

          <constraints>
            - metaTitle: under 60 characters, concise and descriptive. Use sentence case (only capitalize the first word and proper nouns). Do NOT include the site/brand name — it will be appended automatically. Do NOT use separators like "-", "|", or ":" to split the title into parts.
            - metaDescription: under 160 characters, compelling summary of the page
            - Be specific to the actual content, not generic
            - Don't use markdown, just plain text
          </constraints>

          <page>
            <path>${options.fullPath}</path>
            <blocks>${JSON.stringify(options.blocks)}</blocks>
          </page>
          ${stabilityBlock}
        `,
      },
    ],
  });
}

export async function executePageSeo(db: Database, apiKey: string, pageId: number) {
  const page = await db.select().from(pages).where(eq(pages.id, pageId)).get();
  if (!page || page.aiSeoEnabled === false) return;

  const pageBlocks = await db.select().from(blocks).where(eq(blocks.pageId, pageId));
  const sorted = pageBlocks.sort((a, b) => comparePositions(a.position, b.position));

  const defs = await db
    .select()
    .from(blockDefinitions)
    .where(eq(blockDefinitions.projectId, page.projectId));
  const contentSchemaByType = new Map<string, any>();
  const fieldOrderByType = new Map<string, string[]>();
  for (const def of defs) {
    const schema = def.contentSchema as Record<string, unknown> | null;
    if (schema?.properties) {
      contentSchemaByType.set(def.blockId, schema);
      fieldOrderByType.set(def.blockId, Object.keys(schema.properties as Record<string, unknown>));
    }
  }

  const blockIds = sorted.map((b) => b.id);
  const allItems =
    blockIds.length > 0
      ? sortByPosition(
          await db.select().from(repeatableItems).where(inArray(repeatableItems.blockId, blockIds)),
        )
      : [];

  nestChildItems(allItems);

  const itemsByBlock = new Map<number, typeof allItems>();
  for (const item of allItems) {
    if (item.parentItemId !== null) continue;
    const list = itemsByBlock.get(item.blockId) ?? [];
    list.push(item);
    itemsByBlock.set(item.blockId, list);
  }

  const markdownBlocks = sorted.map((block) => {
    const content = { ...(block.content as Record<string, unknown>) };
    const items = itemsByBlock.get(block.id) ?? [];
    const fieldNames = new Set(items.map((i) => i.fieldName));
    for (const fieldName of fieldNames) {
      content[fieldName] = items.filter((i) => i.fieldName === fieldName);
    }

    const stripped = stripNonSeoFields(content);
    const schema = contentSchemaByType.get(block.type);

    return {
      type: block.type,
      markdown:
        schema?.toMarkdown && schema?.properties
          ? contentToMarkdown(schema.toMarkdown, schema.properties, stripped, {
              settings: block.settings as Record<string, unknown> | null | undefined,
            })
          : JSON.stringify(stripped),
    };
  });

  const seo = await generatePageSeoFromAi(apiKey, {
    fullPath: page.fullPath,
    blocks: markdownBlocks,
    previousMetaTitle: page.metaTitle,
    previousMetaDescription: page.metaDescription,
  });

  await db
    .update(pages)
    .set({
      metaTitle: seo.metaTitle,
      metaDescription: seo.metaDescription,
      updatedAt: Date.now(),
    })
    // Generation can outlive a manual edit or a content change. NULL means
    // automatic SEO is enabled by default, just as in the initial check.
    .where(
      and(
        eq(pages.id, pageId),
        sql`${pages.aiSeoEnabled} is not false`,
        eq(pages.updatedAt, page.updatedAt),
        eq(pages.contentUpdatedAt, page.contentUpdatedAt),
        sql`${pages.metaTitle} is ${page.metaTitle}`,
        sql`${pages.metaDescription} is ${page.metaDescription}`,
      ),
    );
}

// --- Content Assembly Helpers ---

export function comparePositions(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function sortByPosition<T extends { position: string }>(items: T[]): T[] {
  return items.sort((a, b) => comparePositions(a.position, b.position));
}

function visitForFileIds(value: unknown, fileIds: Set<number>) {
  if (value == null || typeof value !== "object") return;
  if ("_fileId" in value && (value as { _fileId: unknown })._fileId != null) {
    fileIds.add(Number((value as { _fileId: unknown })._fileId));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitForFileIds(item, fileIds);
    return;
  }
  // Repeatable items arrive as { content, settings, ... } — recurse into `content`
  // when present, otherwise fall back to walking all object values.
  const obj = value as Record<string, unknown>;
  if ("content" in obj && obj.content && typeof obj.content === "object") {
    visitForFileIds(obj.content, fileIds);
    return;
  }
  for (const child of Object.values(obj)) visitForFileIds(child, fileIds);
}

export function collectFileIds(content: Record<string, unknown>, fileIds: Set<number>) {
  for (const value of Object.values(content)) {
    visitForFileIds(value, fileIds);
  }
}

/** Recursively nest child items into their parent item's content. */
export function nestChildItems(
  allItems: { id: number; parentItemId: number | null; fieldName: string; content: unknown }[],
) {
  const childrenByParent = new Map<number, Map<string, typeof allItems>>();
  for (const item of allItems) {
    if (item.parentItemId === null) continue;
    let fieldMap = childrenByParent.get(item.parentItemId);
    if (!fieldMap) {
      fieldMap = new Map();
      childrenByParent.set(item.parentItemId, fieldMap);
    }
    const list = fieldMap.get(item.fieldName) ?? [];
    list.push(item);
    fieldMap.set(item.fieldName, list);
  }
  for (const item of allItems) {
    const childFields = childrenByParent.get(item.id);
    if (!childFields) continue;
    const content = item.content as Record<string, unknown>;
    for (const [fieldName, children] of childFields) {
      content[fieldName] = children;
    }
  }
}

export async function buildFileMap(db: Database, fileIds: Set<number>) {
  if (fileIds.size === 0) return new Map();
  const rows = await db
    .select()
    .from(files)
    .where(inArray(files.id, [...fileIds]));
  return new Map(rows.map((f) => [f.id, f]));
}
