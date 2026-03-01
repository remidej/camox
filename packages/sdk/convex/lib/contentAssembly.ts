import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/* -------------------------------------------------------------------------------------------------
 * Pure helpers (no DB access)
 * -----------------------------------------------------------------------------------------------*/

export type FileDoc = {
  _id: Id<"files">;
  url: string;
  alt: string;
  filename: string;
  mimeType: string;
};

/** Sort items by their `position` field (string comparison for fractional indexing). */
export function sortByPosition<T extends { position: string }>(items: T[]): T[] {
  return items.sort((a, b) => {
    if (a.position < b.position) return -1;
    if (a.position > b.position) return 1;
    return 0;
  });
}

/** Separate scalar fields from array fields in a content object. */
export function splitContent(content: Record<string, unknown>): {
  scalarContent: Record<string, unknown>;
  arrayFields: Record<string, unknown[]>;
} {
  const scalarContent: Record<string, unknown> = {};
  const arrayFields: Record<string, unknown[]> = {};

  for (const [key, value] of Object.entries(content)) {
    if (Array.isArray(value)) {
      arrayFields[key] = value;
    } else {
      scalarContent[key] = value;
    }
  }

  return { scalarContent, arrayFields };
}

/** Recursively collect all _fileId values from a content object. */
export function collectFileIds(
  content: Record<string, unknown>,
  fileIds: Set<string>,
) {
  for (const value of Object.values(content)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if ("_fileId" in obj && typeof obj._fileId === "string") {
        fileIds.add(obj._fileId);
      } else {
        collectFileIds(obj, fileIds);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "content" in item) {
          collectFileIds(
            (item as { content: Record<string, unknown> }).content,
            fileIds,
          );
        } else if (item && typeof item === "object" && !Array.isArray(item)) {
          collectFileIds(item as Record<string, unknown>, fileIds);
        }
      }
    }
  }
}

/**
 * Recursively resolve { _fileId } references in content to full file objects.
 * Old inline {url, alt, filename, mimeType} objects pass through unchanged.
 */
export function resolveFileRefs(
  content: Record<string, unknown>,
  fileMap: Map<string, FileDoc>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(content)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if ("_fileId" in obj && typeof obj._fileId === "string") {
        const file = fileMap.get(obj._fileId);
        if (file) {
          resolved[key] = {
            url: file.url,
            alt: file.alt,
            filename: file.filename,
            mimeType: file.mimeType,
            _fileId: obj._fileId,
          };
        } else {
          // File was deleted or not found
          resolved[key] = { url: "", alt: "", filename: "", mimeType: "" };
        }
      } else {
        // Other object (e.g. legacy inline image, link, etc.) — recurse
        resolved[key] = resolveFileRefs(obj, fileMap);
      }
    } else if (Array.isArray(value)) {
      resolved[key] = value.map((item) => {
        if (item && typeof item === "object" && "content" in item) {
          // DB-backed repeatable item
          return {
            ...item,
            content: resolveFileRefs(
              (item as { content: Record<string, unknown> }).content,
              fileMap,
            ),
          };
        } else if (item && typeof item === "object" && !Array.isArray(item)) {
          return resolveFileRefs(item as Record<string, unknown>, fileMap);
        }
        return item;
      });
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

/** Group repeatable items by `blockId:fieldName`. Items must already be sorted by position. */
export function groupItemsByBlockAndField<
  T extends { blockId: Id<"blocks">; fieldName: string },
>(items: T[]): Record<string, T[]> {
  return items.reduce(
    (acc, item) => {
      const key = `${item.blockId}:${item.fieldName}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    },
    {} as Record<string, T[]>,
  );
}

/** Merge scalar block content with its grouped repeatable items. */
export function reconstructBlockContent(
  blockContent: Record<string, unknown>,
  itemsByBlockAndField: Record<string, unknown[]>,
  blockId: Id<"blocks">,
  allItems: { blockId: Id<"blocks">; fieldName: string }[],
): Record<string, unknown> {
  const reconstructed = { ...blockContent };

  const fieldNames = new Set(
    allItems
      .filter((item) => item.blockId === blockId)
      .map((item) => item.fieldName),
  );

  for (const fieldName of fieldNames) {
    const key = `${blockId}:${fieldName}`;
    reconstructed[fieldName] = itemsByBlockAndField[key] || [];
  }

  return reconstructed;
}

/* -------------------------------------------------------------------------------------------------
 * DB-backed helpers (take QueryCtx)
 * -----------------------------------------------------------------------------------------------*/

/** Batch-fetch all referenced files and build a lookup map. */
export async function buildFileMap(
  ctx: QueryCtx,
  fileIds: Set<string>,
): Promise<Map<string, FileDoc>> {
  const fileMap = new Map<string, FileDoc>();
  await Promise.all(
    [...fileIds].map(async (id) => {
      try {
        const file = await ctx.db.get(id as Id<"files">);
        if (file) {
          fileMap.set(id, file);
        }
      } catch {
        // Not a valid ID, skip
      }
    }),
  );
  return fileMap;
}

/**
 * Full single-block assembly: fetch block → fetch repeatable items → reconstruct → resolve files.
 * Returns `{ type, content }` or null if block not found.
 */
export async function assembleBlockContent(
  ctx: QueryCtx,
  blockId: Id<"blocks">,
): Promise<{ type: string; content: Record<string, unknown> } | null> {
  const block = await ctx.db.get(blockId);
  if (!block) return null;

  // Fetch repeatable items for this block
  const items = await ctx.db
    .query("repeatableItems")
    .withIndex("by_block", (q) => q.eq("blockId", blockId))
    .collect();

  const sortedItems = sortByPosition(items);

  // Reconstruct content with repeatable items merged in
  const itemsByBlockAndField = groupItemsByBlockAndField(sortedItems);
  const content = reconstructBlockContent(
    block.content,
    itemsByBlockAndField,
    blockId,
    sortedItems,
  );

  // Resolve file references
  const fileIds = new Set<string>();
  collectFileIds(content, fileIds);

  if (fileIds.size > 0) {
    const fileMap = await buildFileMap(ctx, fileIds);
    return { type: block.type, content: resolveFileRefs(content, fileMap) };
  }

  return { type: block.type, content };
}

/**
 * Fetch a repeatable item and resolve file refs in its content.
 * Returns `{ type, content }` or null if item not found.
 */
export async function assembleItemContent(
  ctx: QueryCtx,
  itemId: Id<"repeatableItems">,
): Promise<{ type: string; content: Record<string, unknown> } | null> {
  const item = await ctx.db.get(itemId);
  if (!item) return null;

  const content = item.content as Record<string, unknown>;

  // Resolve file references
  const fileIds = new Set<string>();
  collectFileIds(content, fileIds);

  if (fileIds.size > 0) {
    const fileMap = await buildFileMap(ctx, fileIds);
    return { type: item.fieldName, content: resolveFileRefs(content, fileMap) };
  }

  return { type: item.fieldName, content };
}
