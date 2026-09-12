import { queryKeys, type ReadSource } from "@camox/api-contract/query-keys";
import type { QueryClient } from "@tanstack/react-query";
import { useQueries } from "@tanstack/react-query";
import * as React from "react";

import type { BlockBundle, PageStructure, PageWithBlocks } from "./queries";
import { viewBlockQueries } from "./view-queries";

/* -------------------------------------------------------------------------------------------------
 * Types
 * -----------------------------------------------------------------------------------------------*/

export type NormalizedFile = PageWithBlocks["files"][number];
export type NormalizedItem = PageWithBlocks["repeatableItems"][number];
export type NormalizedBlock = PageWithBlocks["blocks"][number];

/* -------------------------------------------------------------------------------------------------
 * Context for block rendering (inside iframe)
 * Provides file/item lookup maps so createBlock components can resolve markers.
 * -----------------------------------------------------------------------------------------------*/

interface NormalizedDataContextValue {
  filesMap: Map<number, NormalizedFile>;
  itemsMap: Map<number, NormalizedItem>;
}

const NormalizedDataContext = React.createContext<NormalizedDataContextValue>({
  filesMap: new Map(),
  itemsMap: new Map(),
});

export const NormalizedDataProvider = ({
  files,
  repeatableItems,
  children,
}: {
  files: NormalizedFile[];
  repeatableItems: NormalizedItem[];
  children: React.ReactNode;
}) => {
  const value = React.useMemo(
    () => ({
      filesMap: new Map(files.map((f) => [f.id, f])),
      itemsMap: new Map(repeatableItems.map((i) => [i.id, i])),
    }),
    [files, repeatableItems],
  );

  return React.createElement(NormalizedDataContext.Provider, { value }, children);
};

export function useNormalizedData() {
  return React.use(NormalizedDataContext);
}

/* -------------------------------------------------------------------------------------------------
 * Helper: resolve page/layout blocks from individual block caches
 * Uses useQueries to subscribe to each block's cache entry.
 * -----------------------------------------------------------------------------------------------*/

const EMPTY_IDS: number[] = [];

/**
 * Returns the previously-returned array when `next` is element-wise identical to
 * it. `useQueries` hands back a fresh `results` array whenever *any* subscribed
 * block refetches, which otherwise produces new `pageBlocks` / `beforeBlocks` /
 * `afterBlocks` / layout-data references on every keystroke-triggered refetch and
 * re-renders unrelated blocks (e.g. the layout's navbar/footer) — even with
 * React Compiler, since its memoization keys on input identity.
 */
function useStableArray<T>(next: T[]): T[] {
  const ref = React.useRef<T[]>(next);
  const prev = ref.current;
  if (prev !== next && (prev.length !== next.length || prev.some((v, i) => v !== next[i]))) {
    ref.current = next;
  }
  return ref.current;
}

export function usePageBlocks(
  pageStructure: { page: Pick<PageStructure["page"], "blockIds">; layout: PageStructure["layout"] },
  source: ReadSource = "draft",
) {
  const blockIds = pageStructure.page.blockIds;
  const beforeIds = pageStructure.layout?.beforeBlockIds ?? EMPTY_IDS;
  const afterIds = pageStructure.layout?.afterBlockIds ?? EMPTY_IDS;

  const allIds = React.useMemo(
    () => [...blockIds, ...beforeIds, ...afterIds],
    [blockIds, beforeIds, afterIds],
  );

  const results = useQueries({
    queries: allIds.map((id) => viewBlockQueries.get(id, source)),
  });

  const bundleMap = React.useMemo(() => {
    const map = new Map<number, BlockBundle>();
    for (let i = 0; i < allIds.length; i++) {
      const data = results[i]?.data;
      if (data) map.set(allIds[i], data);
    }
    return map;
  }, [results, allIds]);

  const layoutIds = React.useMemo(() => [...beforeIds, ...afterIds], [beforeIds, afterIds]);

  const resolveBlocks = (ids: readonly number[]) =>
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
export function isFileMarker(value: unknown): value is { _fileId: number } {
  return (
    value != null &&
    typeof value === "object" &&
    "_fileId" in (value as Record<string, unknown>) &&
    (value as Record<string, unknown>)._fileId != null
  );
}

/** Check if a value is a { _itemId } marker */
export function isItemMarker(value: unknown): value is { _itemId: number } {
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

function visitForFileIds(value: unknown, ids: Set<number>) {
  if (value == null || typeof value !== "object") return;
  if ("_fileId" in value && typeof (value as { _fileId: unknown })._fileId === "number") {
    ids.add((value as { _fileId: number })._fileId);
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

function collectFileIdsFromContent(content: Record<string, unknown>, ids: Set<number>) {
  for (const value of Object.values(content)) {
    visitForFileIds(value, ids);
  }
}

export function seedBlockCaches(
  queryClient: QueryClient,
  pageData: Pick<PageWithBlocks, "blocks" | "files" | "repeatableItems">,
  source: ReadSource = "draft",
) {
  const filesById = new Map(pageData.files.map((f) => [f.id, f]));

  for (const block of pageData.blocks) {
    const blockItems = pageData.repeatableItems.filter((i) => i.blockId === block.id);

    // Collect file IDs referenced by this block and its items
    const fileIds = new Set<number>();
    collectFileIdsFromContent(block.content as Record<string, unknown>, fileIds);
    for (const item of blockItems) {
      collectFileIdsFromContent(item.content as Record<string, unknown>, fileIds);
    }
    const blockFiles = [...fileIds].map((id) => filesById.get(id)).filter((f) => f != null);

    queryClient.setQueryData(queryKeys.blocks.get(block.id, source), {
      block,
      repeatableItems: blockItems,
      files: blockFiles,
    });

    for (const file of blockFiles) {
      queryClient.setQueryData(queryKeys.files.get(file.id), file);
    }
  }
}

/** Resolve a file marker to a full file object */
export function resolveFileMarker(
  marker: { _fileId: number },
  filesMap: Map<number, NormalizedFile>,
): {
  url: string;
  alt: string;
  filename: string;
  mimeType: string;
  size: number;
  _fileId: number;
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
