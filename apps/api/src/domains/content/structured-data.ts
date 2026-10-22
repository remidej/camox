import type { EvaluatedNode, PageUrlMarker } from "@camox/api-contract";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import {
  contentToStructuredData,
  type StructuredDataContext,
} from "../../lib/content-structured-data";
import { pages } from "../../schema";
import { nestChildItems } from "../_shared/block-markers";
import { propertiesOf } from "../_shared/fields";
import type { ContentScope } from "../collections/identity";
import { inDefaultLocale, type ReadScope } from "../drafts/scope";
import type { BlockBundle } from "./blocks";
import { selectInChunks } from "./chunks";
import type { Definitions } from "./definitions";

/** Each block's Structured Data nodes, by block id. Blocks without nodes are left out. */
export type BlockStructuredData = Record<string, EvaluatedNode[]>;

/** The locale a scope names, if any; without one it reads the default locale. */
function localeOf(scope: ReadScope): string | undefined {
  return scope !== null && "locale" in scope ? scope.locale : undefined;
}

/**
 * The Structured Data nodes of a bundle's blocks, from their definitions' `toStructuredData`
 * templates, with each repeatable item's nodes where its parent's template places its repeater.
 *
 * Links to pages become markers naming the page's path, in the scope's locale, or the default
 * locale's when the page isn't in it (ADR 0015), which the runtime turns into absolute URLs. It
 * reads at most one query per 90 linked pages, plus as many for pages missing from the locale.
 */
export const blockStructuredData = Effect.fn("content.blockStructuredData")(function* (
  db: Database,
  at: ContentScope,
  definitions: Definitions,
  bundle: BlockBundle,
): Effect.fn.Return<BlockStructuredData> {
  const blockDefinitions = yield* definitions.blocks();
  const files = new Map(bundle.files.map((file) => [file.id, file]));
  // Item content holds markers for nested repeaters; each item gets its own copy to nest into.
  const items = bundle.repeatableItems.map((item) => ({
    ...item,
    content: { ...(item.content as Record<string, unknown>) },
  }));
  nestChildItems(items);
  const topItems = Map.groupBy(
    items.filter((item) => item.parentItemId === null),
    (item) => item.blockId,
  );
  const templated = bundle.blocks.flatMap((block) => {
    const schema = blockDefinitions.get(block.type)?.contentSchema as
      | { toStructuredData?: unknown }
      | undefined;
    if (schema?.toStructuredData === undefined) return [];
    const content: Record<string, unknown> = { ...(block.content as Record<string, unknown>) };
    const blockItems = topItems.get(block.id) ?? [];
    for (const fieldName of new Set(blockItems.map((item) => item.fieldName))) {
      content[fieldName] = blockItems.filter((item) => item.fieldName === fieldName);
    }
    return [{ block, schema, content }];
  });
  const evaluateAll = (pageUrl: StructuredDataContext["pageUrl"]) =>
    templated.map(({ block, schema, content }) => ({
      id: block.id,
      nodes: contentToStructuredData(schema.toStructuredData, propertiesOf(schema), content, {
        settings: block.settings as Record<string, unknown> | null,
        files,
        references: block.references,
        pageUrl,
      }),
    }));

  // A first pass finds the pages the nodes link to, so they're read together.
  const linked = new Set<string>();
  evaluateAll((pageId) => {
    linked.add(pageId);
    return undefined;
  });
  const urls = yield* pageUrls(db, at, [...linked]);

  const result: BlockStructuredData = {};
  for (const { id, nodes } of evaluateAll((pageId) => urls.get(pageId))) {
    if (nodes.length > 0) result[id] = nodes;
  }
  return result;
});

/** The URL markers of the pages given, by id: in the scope's locale, else the default one's. */
const pageUrls = Effect.fn("content.pageUrls")(function* (
  db: Database,
  at: ContentScope,
  ids: readonly string[],
) {
  const urls = new Map<string, PageUrlMarker>();
  if (ids.length === 0) return urls;
  const read = (scope: ReadScope, wanted: readonly string[]) =>
    selectInChunks(db, scope, pages, wanted, (chunk) =>
      and(eq(pages.projectId, at.projectId), inArray(pages.id, chunk)),
    );
  const locale = localeOf(at.draft);
  for (const page of yield* read(at.draft, ids)) {
    urls.set(page.id, {
      "@camox": "pageUrl",
      path: page.fullPath,
      ...(locale !== undefined && { locale }),
    });
  }
  const missing = ids.filter((id) => !urls.has(id));
  if (locale === undefined || missing.length === 0) return urls;
  for (const page of yield* read(inDefaultLocale(at.draft), missing)) {
    urls.set(page.id, { "@camox": "pageUrl", path: page.fullPath });
  }
  return urls;
});
