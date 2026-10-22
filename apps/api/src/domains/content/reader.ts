import { Effect } from "effect";

import type { Database } from "../../db";
import type { blocks, pages, repeatableItems } from "../../schema";
import type { ContentScope } from "../collections/identity";
import { withSeo } from "../pages/generated-seo";
import {
  type BlockBundle,
  type BlockMarkdown,
  type ShownBlock,
  type ShownItem,
  blockBundle,
  blockMarkdown,
  type BlockSource,
  itemBundle,
  shownBlocks,
  shownItems,
} from "./blocks";
import { definitionsOf } from "./definitions";
import {
  recordMarkdown,
  type RecordRow,
  type RecordView,
  recordViews,
  type ShownRecord,
  shownRecords,
} from "./records";
import { blockStructuredData, type BlockStructuredData } from "./structured-data";

export type {
  BlockBundle,
  BlockMarkdown,
  BlockSource,
  BlockStructuredData,
  RecordView,
  ShownBlock,
  ShownItem,
  ShownRecord,
};
export type { ResolvedReference, ResolvedReferences } from "./references";
export type { ResolvedAsset } from "./files";

type BlockRow = typeof blocks.$inferSelect;
type ItemRow = typeof repeatableItems.$inferSelect;
type PageRow = typeof pages.$inferSelect;

/**
 * The content reader: the only way content leaves the API. It returns content the way a draft
 * scope (or Live) shows it, with every step applied, for reads and write responses alike:
 * - draft rows over Live's (ADR 0005), and synced placements showing their shared content;
 * - conformed to the definitions in effect for the scope (ADR 0006, 0007), always;
 * - with its generated values: summaries, page SEO (ADR 0012);
 * - and, for full views, the records it references and the files it places, resolved in the
 *   scope and in the reader's project only.
 *
 * A reader is bound to one project and scope, which the caller got from content access: it
 * checks no access itself. It reads each kind of definition at most once, the first time a view
 * needs it, and never caches content, so a view asked for after a write sees the write. A view
 * costs the same queries whatever the number of blocks, items, records or files it covers: one
 * per kind of row per 90 ids, plus one per distinct query-backed reference list. Nothing fails:
 * what the scope doesn't show is left out, or reads as empty.
 *
 * `shown` views are the cheap tier, for write responses and lists: no references or files.
 */
export function contentReader(ctx: { db: Database }, at: ContentScope) {
  const { db } = ctx;
  const definitions = definitionsOf(db, at);
  return {
    at,
    shown: {
      /** Blocks as readers see them, in the order given, each with its summary. */
      blocks: (rows: readonly BlockRow[]) => shownBlocks(db, at, definitions, rows),
      /**
       * Items as readers see them, in the order given, each with its summary. An item under a
       * removed repeater or block definition has no content or settings.
       */
      items: (rows: readonly ItemRow[]) => shownItems(db, at, definitions, rows),
      /** Records of a collection with their labels; none when the scope has no such collection. */
      records: (collectionId: string, rows: readonly RecordRow[]) =>
        shownRecords(definitions, collectionId, rows),
      /** Pages with the SEO in effect: manual, or generated. */
      pages: <P extends PageRow>(rows: readonly P[]) => withSeo(db, at.draft, rows),
    },
    /** A collection's definition as the scope reads it, or undefined when it has none. */
    collection: (collectionId: string) =>
      Effect.map(definitions.collections(), (collections) => collections.get(collectionId)),
    /**
     * Blocks with their items, the records they reference (two hops) and the files they place.
     * Blocks and items carry `{ _itemId }` markers for their repeaters.
     */
    blocks: (source: BlockSource) => blockBundle(db, at, definitions, source),
    /**
     * The Structured Data nodes of a bundle's blocks, by block id, from their templates. Reads
     * only the pages the nodes link to.
     */
    structuredData: (bundle: BlockBundle) => blockStructuredData(db, at, definitions, bundle),
    /** The Markdown Representation of each block whose definition the scope has, by position. */
    markdown: (source: BlockSource) => blockMarkdown(db, at, definitions, source),
    /** One item as `blocks` shows items, with its files; undefined when the scope hides it. */
    item: (row: ItemRow) => itemBundle(db, at, definitions, row),
    /** Records with their files resolved and the records they reference (one hop). */
    records: (collectionId: string, rows: readonly RecordRow[]) =>
      recordViews(db, at, definitions, collectionId, rows),
    /** A record's Markdown, from `toMarkdown` lines; undefined when the scope hides it. */
    recordMarkdown: (collectionId: string, row: RecordRow, toMarkdown: readonly string[]) =>
      recordMarkdown(db, at, definitions, collectionId, row, toMarkdown),
  };
}

export type ContentReader = ReturnType<typeof contentReader>;
