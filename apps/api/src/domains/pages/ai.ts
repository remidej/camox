import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { outdent } from "outdent";
import { z } from "zod";

import type { Database } from "../../db";
import { contentToMarkdown, stripArtifactSources } from "../../lib/content-markdown";
import { blockDefinitions, blocks, files, pages, repeatableItems } from "../../schema";
import { conformBlocks } from "../_shared/conform-content";
import { withSharedContent } from "../blocks/shared-content";
import * as overlay from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import { draftScopeOfJob } from "../drafts/service";
import { type FileView, withFileMetadata } from "../files/generated-metadata";
import { homeOf, readValue, saveValue, settleRequest } from "../generated-values/service";
import { seoGenerated, seoKey } from "./generated-seo";

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

const generatePageSeoFromAi = Effect.fn("generatePageSeoFromAi")(function* (
  apiKey: string,
  options: {
    fullPath: string;
    blocks: { type: string; markdown: string }[];
    previousMetaTitle?: string | null;
    previousMetaDescription?: string | null;
  },
  abortController?: AbortController,
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

  return yield* Effect.promise(() =>
    chat({
      adapter: createOpenRouterText("google/gemini-3-flash-preview", apiKey),
      abortController,
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
    }),
  );
});

/**
 * Generates a page's SEO as the scope reads it, into the scope's generated values: never into
 * the page, so it never copies one into a draft (ADR 0012). Pages with manual SEO are skipped.
 */
export const executePageSeo = Effect.fn("pages.executePageSeo")(function* (
  db: Database,
  apiKey: string,
  pageId: string,
  scope: DraftScope,
  abortController?: AbortController,
) {
  const startedAt = Date.now();
  const page = yield* overlay.get(db, scope, pages, pageId);
  if (!page) return;
  const home = homeOf(scope, page.projectId);
  if (!seoGenerated(page)) {
    yield* settleRequest(db, home, seoKey(pageId), startedAt);
    return;
  }

  const pageBlocks = yield* overlay.select(db, scope, blocks, eq(blocks.pageId, pageId));

  const defs = yield* Effect.promise(() =>
    db
      .select()
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, page.projectId),
          eq(blockDefinitions.environmentId, page.environmentId),
        ),
      ),
  );
  const definitions = new Map(defs.map((def) => [def.blockId, def]));
  // Blocks of a removed definition render nothing, so they say nothing about the page either.
  const sorted = overlay.sortByPosition(pageBlocks.filter((block) => definitions.has(block.type)));
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
  const shown = yield* withSharedContent(
    db,
    scope,
    sorted,
    blockIds.length > 0
      ? yield* overlay.select(
          db,
          scope,
          repeatableItems,
          inArray(repeatableItems.blockId, blockIds),
        )
      : [],
  );
  const conformed = conformBlocks(definitions, shown.blocks, sortItemsByPosition(shown.items));
  const allItems = conformed.items;

  nestChildItems(allItems);

  const itemsByBlock = new Map<string, typeof allItems>();
  for (const item of allItems) {
    if (item.parentItemId !== null) continue;
    const list = itemsByBlock.get(item.blockId) ?? [];
    list.push(item);
    itemsByBlock.set(item.blockId, list);
  }

  const markdownBlocks = conformed.blocks.map((block) => {
    const content = { ...(block.content as Record<string, unknown>) };
    const items = itemsByBlock.get(block.id) ?? [];
    const fieldNames = new Set(items.map((i) => i.fieldName));
    for (const fieldName of fieldNames) {
      content[fieldName] = items.filter((i) => i.fieldName === fieldName);
    }

    const schema = contentSchemaByType.get(block.type);
    const stripped = stripNonSeoFields(stripArtifactSources(schema?.properties, content));

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

  const previous = (yield* readValue(db, scope, seoKey(pageId))).value;
  const seo = yield* generatePageSeoFromAi(
    apiKey,
    {
      fullPath: page.fullPath,
      blocks: markdownBlocks,
      previousMetaTitle: previous?.metaTitle,
      previousMetaDescription: previous?.metaDescription,
    },
    abortController,
  );
  yield* saveValue(
    db,
    home,
    seoKey(pageId),
    { metaTitle: seo.metaTitle, metaDescription: seo.metaDescription },
    startedAt,
  );
  return { projectId: page.projectId };
});

/**
 * Runs a page SEO job in the scope it was scheduled from. Returns the page's project to
 * refresh, or undefined when the draft has ended or the page is gone.
 */
export const runPageSeoJob = Effect.fn("pages.runPageSeoJob")(function* (
  db: Database,
  apiKey: string,
  job: { entityId: string; draftId: string | null },
  abortController?: AbortController,
) {
  const scope = yield* draftScopeOfJob(db, job.draftId);
  if (scope === undefined) return undefined;
  return yield* executePageSeo(db, apiKey, job.entityId, scope, abortController);
});

// --- Content Assembly Helpers ---

/**
 * Sorts repeatable items by position, then by id: positions picked in different drafts can
 * collide (ADR 0005).
 */
export function sortItemsByPosition<T extends { position: string; id: string }>(items: T[]): T[] {
  return overlay.sortByPosition(items);
}

function visitForFileIds(value: unknown, fileIds: Set<string>) {
  if (value == null || typeof value !== "object") return;
  if ("_fileId" in value) {
    const fileId = (value as { _fileId: unknown })._fileId;
    if (typeof fileId === "string") fileIds.add(fileId);
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

export function collectFileIds(content: Record<string, unknown>, fileIds: Set<string>) {
  for (const value of Object.values(content)) {
    visitForFileIds(value, fileIds);
  }
}

/** Recursively nest child items into their parent item's content. */
export function nestChildItems(
  allItems: { id: string; parentItemId: string | null; fieldName: string; content: unknown }[],
) {
  const childrenByParent = new Map<string, Map<string, typeof allItems>>();
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

/** The files content uses, by id, as the scope reads them: a draft shows its replaced bytes. */
export const buildFileMap = Effect.fn("pages.buildFileMap")(function* (
  db: Database,
  fileIds: Set<string>,
  scope: DraftScope,
) {
  if (fileIds.size === 0) return new Map<string, FileView>();
  const rows = yield* overlay.select(db, scope, files, inArray(files.id, [...fileIds]));
  return new Map((yield* withFileMetadata(db, scope, rows)).map((f) => [f.id, f]));
});
