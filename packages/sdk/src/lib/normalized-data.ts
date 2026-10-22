import * as React from "react";

import type { BlockBundle, PageStructure, PageWithBlocks } from "./queries";
import { reads, useReadQueries } from "./studio-reads";

/* -------------------------------------------------------------------------------------------------
 * Types
 * -----------------------------------------------------------------------------------------------*/

export type NormalizedFile = PageWithBlocks["files"][number];
/** The draft overlay's bookkeeping on stored rows (ADR 0005), which the studio never reads. */
type RowBookkeeping =
  | "rowId"
  | "draftId"
  | "version"
  | "baseVersion"
  | "deleted"
  | "firstPublishedAt"
  | "publishedAt"
  | "publishedBy";
export type NormalizedItem = Omit<PageWithBlocks["repeatableItems"][number], RowBookkeeping>;
export type NormalizedBlock = PageWithBlocks["blocks"][number];

export interface NormalizedCollectionRecord {
  id: string;
  collectionId: string;
  content: Record<string, unknown>;
  title: string;
  description: string | null;
  version?: number;
  revisionId?: string;
  /** The records this record links, when a block or item placed it (the first hop). */
  references?: NormalizedReferences;
}

/** A record (or null) per reference field, the resolved records in order per reference list. */
export type NormalizedReferences = Record<
  string,
  NormalizedCollectionRecord | NormalizedCollectionRecord[] | null
>;

/** A block or repeatable item, with the records its reference fields link. */
type ReferenceBlock = {
  id?: string;
  references?: NormalizedReferences;
};
const EMPTY_REFERENCE_BLOCKS: ReferenceBlock[] = [];

/** Every record a block's references and reference lists resolve to. */
export function referencedRecords(references: NormalizedReferences | undefined) {
  return Object.values(references ?? {}).flatMap((value) => value ?? []);
}

/** The records references resolve to, and the records those link in turn (both hops). */
export function linkedRecords(
  references: NormalizedReferences | undefined,
): NormalizedCollectionRecord[] {
  return referencedRecords(references).flatMap((record) => [
    record,
    ...referencedRecords(record.references),
  ]);
}

/** A single reference field's record; reference lists never resolve to one record. */
export function singleReference(references: NormalizedReferences | undefined, fieldName: string) {
  const value = references?.[fieldName];
  return value && !Array.isArray(value) ? value : null;
}

/** A reference list field's records, in list order; single references resolve to none. */
export function referenceList(references: NormalizedReferences | undefined, fieldName: string) {
  const value = references?.[fieldName];
  return Array.isArray(value) ? value : [];
}

/** The records a reference or reference list field places, in order. */
export function placedRecords(references: NormalizedReferences | undefined, fieldName: string) {
  return [references?.[fieldName] ?? []].flat();
}

/* -------------------------------------------------------------------------------------------------
 * Context for block rendering (inside iframe)
 * Provides file/item lookup maps so createBlock components can resolve markers.
 * -----------------------------------------------------------------------------------------------*/

interface NormalizedDataContextValue {
  filesMap: Map<string, NormalizedFile>;
  itemsMap: Map<string, NormalizedItem>;
  recordsMap: Map<string, NormalizedCollectionRecord>;
  /** Each block's resolved references, by block id. */
  blockReferences: Map<string, NormalizedReferences>;
}

const NormalizedDataContext = React.createContext<NormalizedDataContextValue>({
  filesMap: new Map(),
  itemsMap: new Map(),
  recordsMap: new Map(),
  blockReferences: new Map(),
});

/**
 * The record ids a query-backed list resolved to on the server, in order. The block or item
 * stores no value for it: its owner's resolved references carry the results.
 */
export function queryResultIds(
  data: NormalizedDataContextValue,
  owner: { blockId: string; itemId?: string },
  fieldName: string,
) {
  const references =
    owner.itemId == null
      ? data.blockReferences.get(owner.blockId)
      : (data.itemsMap.get(owner.itemId) as ReferenceBlock | undefined)?.references;
  return referenceList(references, fieldName).map((record) => record.id);
}

export const NormalizedDataProvider = ({
  files,
  repeatableItems,
  blocks = EMPTY_REFERENCE_BLOCKS,
  children,
}: {
  files: NormalizedFile[];
  repeatableItems: NormalizedItem[];
  blocks?: readonly ReferenceBlock[];
  children: React.ReactNode;
}) => {
  const value = React.useMemo(
    () => ({
      filesMap: new Map(files.map((f) => [f.id, f])),
      itemsMap: new Map(repeatableItems.map((i) => [i.id, i])),
      // Blocks and repeatable items both link records; a record resolves the same either way.
      recordsMap: new Map(
        [...blocks, ...repeatableItems].flatMap((owner) =>
          linkedRecords((owner as ReferenceBlock).references).map(
            (record) => [record.id, record] as const,
          ),
        ),
      ),
      blockReferences: new Map(
        blocks.flatMap((block) =>
          block.id == null ? [] : [[block.id, block.references ?? {}] as const],
        ),
      ),
    }),
    [files, repeatableItems, blocks],
  );

  return React.createElement(NormalizedDataContext.Provider, { value }, children);
};

export function useNormalizedData() {
  return React.use(NormalizedDataContext);
}

/**
 * Adds the records a record page's record links to the records its fields resolve
 * references from. A record page places its record through no block, so no block carries them.
 */
export const LinkedRecordsProvider = ({
  references,
  children,
}: {
  references: NormalizedReferences | undefined;
  children: React.ReactNode;
}) => {
  const outer = React.use(NormalizedDataContext);
  const value = React.useMemo(
    () => ({
      ...outer,
      recordsMap: new Map([
        ...outer.recordsMap,
        ...linkedRecords(references).map((record) => [record.id, record] as const),
      ]),
    }),
    [outer, references],
  );
  return React.createElement(NormalizedDataContext.Provider, { value }, children);
};

/* -------------------------------------------------------------------------------------------------
 * Helper: resolve page/layout blocks from individual block caches
 * Uses useQueries to subscribe to each block's cache entry.
 * -----------------------------------------------------------------------------------------------*/

const EMPTY_IDS: string[] = [];

/**
 * Returns the previously-returned array when `next` is element-wise identical to
 * it. `useQueries` hands back a fresh `results` array whenever *any* subscribed
 * block refetches, which otherwise produces new `pageBlocks` / `beforeBlocks` /
 * `afterBlocks` / layout-data references on every keystroke-triggered refetch and
 * re-renders unrelated blocks (e.g. the layout's navbar/footer) — even with
 * React Compiler, since its memoization keys on input identity.
 */
function useStableArray<T>(next: T[]): T[] {
  const [prev, setPrev] = React.useState(next);
  if (prev !== next && (prev.length !== next.length || prev.some((v, i) => v !== next[i]))) {
    setPrev(next);
    return next;
  }
  return prev;
}

export function usePageBlocks(pageStructure: {
  page: Pick<PageStructure["page"], "blockIds">;
  layout: PageStructure["layout"];
}) {
  const blockIds = pageStructure.page.blockIds;
  const beforeIds = pageStructure.layout?.beforeBlockIds ?? EMPTY_IDS;
  const afterIds = pageStructure.layout?.afterBlockIds ?? EMPTY_IDS;

  const allIds = React.useMemo(
    () => [...blockIds, ...beforeIds, ...afterIds],
    [blockIds, beforeIds, afterIds],
  );

  const results = useReadQueries(allIds.map((id) => reads.blockBundle(id)));

  const bundleMap = React.useMemo(() => {
    const map = new Map<string, BlockBundle>();
    for (let i = 0; i < allIds.length; i++) {
      const data = results[i]?.data;
      if (data) map.set(allIds[i], data);
    }
    return map;
  }, [results, allIds]);

  const layoutIds = React.useMemo(() => [...beforeIds, ...afterIds], [beforeIds, afterIds]);

  const resolveBlocks = (ids: readonly string[]) =>
    ids.map((id) => bundleMap.get(id)?.block).filter((b): b is NormalizedBlock => b != null);

  const pageBlocks = useStableArray(resolveBlocks(blockIds));
  const beforeBlocks = useStableArray(resolveBlocks(beforeIds));
  const afterBlocks = useStableArray(resolveBlocks(afterIds));
  // Merge files and items from layout block bundles for NormalizedDataProvider
  const layoutFiles = useStableArray(layoutIds.flatMap((id) => bundleMap.get(id)?.files ?? []));
  const layoutItems = useStableArray(
    layoutIds.flatMap((id) => bundleMap.get(id)?.repeatableItems ?? []),
  );

  return React.useMemo(
    () => ({ pageBlocks, beforeBlocks, afterBlocks, layoutFiles, layoutItems }),
    [pageBlocks, beforeBlocks, afterBlocks, layoutFiles, layoutItems],
  );
}

/* -------------------------------------------------------------------------------------------------
 * Marker resolution helpers
 * -----------------------------------------------------------------------------------------------*/

/** Check if a value is a { _fileId } marker */
export function isFileMarker(value: unknown): value is { _fileId: string } {
  return (
    value != null &&
    typeof value === "object" &&
    "_fileId" in (value as Record<string, unknown>) &&
    (value as Record<string, unknown>)._fileId != null
  );
}

/** Check if a value is a { _itemId } marker */
export function isItemMarker(value: unknown): value is { _itemId: string } {
  return (
    value != null &&
    typeof value === "object" &&
    "_itemId" in (value as Record<string, unknown>) &&
    (value as Record<string, unknown>)._itemId != null
  );
}

/* -------------------------------------------------------------------------------------------------
 * Seed individual block caches from page response
 * Each block gets its own cache entry matching the blocks.get endpoint shape.
 * This enables granular invalidation — content edits refetch only the affected block.
 * -----------------------------------------------------------------------------------------------*/

function visitForFileIds(value: unknown, ids: Set<string>) {
  if (value == null || typeof value !== "object") return;
  if ("_fileId" in value && typeof (value as { _fileId: unknown })._fileId === "string") {
    ids.add((value as { _fileId: string })._fileId);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitForFileIds(item, ids);
    return;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    visitForFileIds(child, ids);
  }
}

function collectFileIdsFromContent(content: Record<string, unknown>, ids: Set<string>) {
  for (const value of Object.values(content)) {
    visitForFileIds(value, ids);
  }
}

/**
 * The files a block places: in its content, its items' content, and the content of the records
 * they link.
 */
export function collectFileIds(
  block: Pick<NormalizedBlock, "content">,
  items: ReadonlyArray<Pick<NormalizedItem, "content">>,
): Set<string> {
  const fileIds = new Set<string>();
  for (const owner of [block, ...items]) {
    collectFileIdsFromContent(owner.content as Record<string, unknown>, fileIds);
    for (const record of linkedRecords((owner as ReferenceBlock).references)) {
      collectFileIdsFromContent(record.content, fileIds);
    }
  }
  return fileIds;
}

/** Materialized collection revisions own their asset metadata. Only marker-only
 * values consult the mutable file map, so a published source cannot change when
 * the file's current metadata changes.
 */
export function resolveAssetValue(value: unknown, filesMap: Map<string, NormalizedFile>): unknown {
  if (value && typeof value === "object" && "url" in value && typeof value.url === "string") {
    return value;
  }
  return isFileMarker(value) ? resolveFileMarker(value, filesMap) : value;
}

/** Resolve a file marker to a full file object */
export function resolveFileMarker(
  marker: { _fileId: string },
  filesMap: Map<string, NormalizedFile>,
): {
  url: string;
  alt: string;
  filename: string;
  mimeType: string;
  size: number;
  _fileId: string;
} {
  const file = filesMap.get(marker._fileId);
  if (file) {
    return {
      url: file.url,
      alt: file.alt,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
      _fileId: marker._fileId,
    };
  }
  return { url: "", alt: "", filename: "", mimeType: "", size: 0, _fileId: marker._fileId };
}
