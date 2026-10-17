import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { AiModel } from "../../lib/ai-model";
import { contentToMarkdown, stripArtifactSources } from "../../lib/content-markdown";
import type { Journal } from "../../lib/journal";
import type { AiCallError } from "../../lib/retry-ai-call";
import { blockDefinitions, blocks, pages, repeatableItems } from "../../schema";
import { nestChildItems } from "../_shared/block-markers";
import { conformBlocks } from "../_shared/conform-content";
import { definitionsIn } from "../_shared/definitions";
import { withSharedContent } from "../blocks/shared-content";
import * as overlay from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import type { Stale } from "../generated-values/generation";
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

/**
 * Generates a page's SEO as the scope reads it, into the scope's generated values: never into
 * the page, so it never copies one into a draft (ADR 0012). Pages with manual SEO are skipped.
 */
export const executePageSeo = Effect.fn("pages.executePageSeo")(function* (
  db: Database,
  scope: DraftScope,
  pageId: string,
  startedAt: number,
): Effect.fn.Return<Stale | null, AiCallError, AiModel | Journal> {
  const page = yield* overlay.get(db, scope, pages, pageId);
  if (!page) return null;
  const home = homeOf(scope, page.projectId);
  if (!seoGenerated(page)) {
    yield* settleRequest(db, home, seoKey(pageId), startedAt);
    return null;
  }

  const pageBlocks = yield* overlay.select(db, scope, blocks, eq(blocks.pageId, pageId));

  const defs = yield* Effect.promise(() =>
    db
      .select()
      .from(blockDefinitions)
      .where(
        and(eq(blockDefinitions.projectId, page.projectId), definitionsIn(blockDefinitions, scope)),
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
  const conformed = conformBlocks(definitions, shown.blocks, overlay.sortByPosition(shown.items));
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
  const model = yield* AiModel;
  const seo = yield* model.pageSeo({
    fullPath: page.fullPath,
    blocks: markdownBlocks,
    previousMetaTitle: previous?.metaTitle,
    previousMetaDescription: previous?.metaDescription,
  });
  yield* saveValue(
    db,
    home,
    seoKey(pageId),
    { metaTitle: seo.metaTitle, metaDescription: seo.metaDescription },
    startedAt,
  );
  // A page's SEO makes nothing else stale.
  return null;
});
