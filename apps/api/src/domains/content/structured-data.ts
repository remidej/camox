import {
  ARTICLE_TYPES,
  type EvaluatedNode,
  type PageUrlMarker,
  recordLink,
  type RecordStructuredData,
  type StructuredDataValue,
} from "@camox/api-contract";
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
import type { CollectionDefinition, Definitions } from "./definitions";
import type { ResolvedReference, ResolvedReferences } from "./references";

export type { RecordStructuredData };

/** Each block's Structured Data nodes, by block id. Blocks without nodes are left out. */
export type BlockStructuredData = Record<string, EvaluatedNode[]>;

/** A bundle's Structured Data: its blocks' nodes, and the nodes of the records they reference. */
export type BundleStructuredData = { blocks: BlockStructuredData; records: RecordStructuredData };

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
 *
 * References become links to their records' nodes, which come beside the blocks' nodes, for the
 * records the blocks and items reference and those these records link.
 */
export const blockStructuredData = Effect.fn("content.blockStructuredData")(function* (
  db: Database,
  at: ContentScope,
  definitions: Definitions,
  bundle: BlockBundle,
): Effect.fn.Return<BundleStructuredData> {
  const blockDefinitions = yield* definitions.blocks();
  const collections = yield* definitions.collections();
  const record = recordValue(collections);
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
        record,
      }),
    }));

  // A first pass finds the pages the nodes link to, so they're read together.
  const linked = new Set<string>();
  evaluateAll((pageId) => {
    linked.add(pageId);
    return undefined;
  });
  const urls = yield* pageUrls(db, at, [...linked]);

  const blocks: BlockStructuredData = {};
  for (const { id, nodes } of evaluateAll((pageId) => urls.get(pageId))) {
    if (nodes.length > 0) blocks[id] = nodes;
  }
  const holders = [...bundle.blocks, ...bundle.repeatableItems];
  const records = recordStructuredData(
    collections,
    holders.map((holder) => holder.references),
    files,
  );
  return { blocks, records };
});

/**
 * The value a reference to a record takes in a Structured Data template: a link to the record's
 * node when its collection has a template, else its title.
 */
export function recordValue(collections: ReadonlyMap<string, CollectionDefinition>) {
  return (record: ResolvedReference): StructuredDataValue | undefined =>
    collections.get(record.collectionId)?.toStructuredData
      ? recordLink(record.id)
      : record.title || undefined;
}

/** Every record of resolved references, a record placed with its own references first. */
function recordsIn(roots: readonly ResolvedReferences[]) {
  const found = new Map<string, ResolvedReference>();
  const visit = (references: ResolvedReferences | undefined) => {
    for (const value of Object.values(references ?? {})) {
      for (const record of [value ?? []].flat()) {
        const known = found.get(record.id);
        if (known && (known.references || !record.references)) continue;
        found.set(record.id, record);
        visit(record.references);
      }
    }
  };
  roots.forEach(visit);
  return found;
}

/**
 * The nodes of the records content references, the records they link in turn included, from
 * their collections' `toStructuredData` templates. Each record's node is evaluated once,
 * whatever the number of places referencing it. A node takes its record's title as its name, or
 * as its headline for an Article, and its record's description, unless its template sets them.
 * Reads nothing: the records are those the content's references resolved.
 */
export function recordStructuredData(
  collections: ReadonlyMap<string, CollectionDefinition>,
  roots: readonly ResolvedReferences[],
  files: StructuredDataContext["files"],
): RecordStructuredData {
  const records = recordsIn(roots);
  const templateOf = (record: ResolvedReference) =>
    collections.get(record.collectionId)?.toStructuredData ?? undefined;
  const referenced = new Set<string>();
  for (const root of roots) {
    for (const value of Object.values(root)) {
      for (const record of [value ?? []].flat()) {
        if (templateOf(record)) referenced.add(record.id);
      }
    }
  }
  const nodes: Record<string, EvaluatedNode> = {};
  for (const record of records.values()) {
    const node = recordNode(collections, record, files);
    if (node) nodes[record.id] = node;
  }
  return { nodes, referenced: [...referenced].filter((id) => id in nodes) };
}

/**
 * A record's node, from its collection's template, or none without one. Its references link the
 * records they resolved to; a record placed beyond the last hop links none.
 */
export function recordNode(
  collections: ReadonlyMap<string, CollectionDefinition>,
  record: ResolvedReference,
  files: StructuredDataContext["files"],
): EvaluatedNode | undefined {
  const definition = collections.get(record.collectionId);
  if (!definition?.toStructuredData) return undefined;
  const [node] = contentToStructuredData(
    definition.toStructuredData,
    propertiesOf(definition.contentSchema),
    record.content,
    {
      files,
      references: record.references,
      // Collections hold no links to pages.
      pageUrl: () => undefined,
      record: recordValue(collections),
    },
  );
  if (!node) return undefined;
  const named = ARTICLE_TYPES.includes(node["@type"] as never) ? "headline" : "name";
  return {
    ...(record.title && { [named]: record.title }),
    ...(record.description && { description: record.description }),
    ...node,
    "@id": recordLink(record.id)["@id"],
  };
}

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
