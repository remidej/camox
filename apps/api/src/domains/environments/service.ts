import { queryKeys } from "@camox/api-contract/query-keys";
import { and, eq, inArray, or } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { getAuthorizedProject, requireUser } from "../../authorization";
import type { Database } from "../../db";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { decodeInput, IncompatibleEnvironmentsError, InvalidInputError } from "../../lib/errors";
import { type JsonValue, remapFileReferences } from "../../lib/remap-file-references";
import { resolveEnvironment } from "../../lib/resolve-environment";
import { stableStringify } from "../../lib/stable-stringify";
import {
  blockDefinitions,
  collectionDefinitions,
  collectionRecords,
  blocks,
  comments,
  files,
  layoutCheckpoints,
  layouts,
  pageCheckpoints,
  pages,
  repeatableItems,
} from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { layoutSnapshotSchema, pageSnapshotSchema } from "../_shared/snapshot-schemas";

// --- Input Schemas ---

export const checkCompatibilityInput = z.object({
  projectId: z.number(),
  sourceEnvName: z.string(),
  targetEnvName: z.string(),
});

export const replicateEnvironmentInput = z.object({
  projectId: z.number(),
  sourceEnvName: z.string(),
  targetEnvName: z.string(),
});

// --- Compatibility reasons ---
//
// Returned (and re-emitted via `IncompatibleEnvironmentsError`) so the studio
// can render a clear "Cannot push because…" message per offending key.

export type CompatibilityReason =
  | { kind: "collections-replication-unsupported" }
  | { kind: "block-definition-missing-in-source"; blockId: string }
  | { kind: "block-definition-missing-in-target"; blockId: string }
  | {
      kind: "block-definition-schema-mismatch";
      blockId: string;
      field: "contentSchema" | "settingsSchema" | "layoutOnly" | "synced";
    }
  | { kind: "layout-missing-in-source"; layoutId: string }
  | { kind: "layout-missing-in-target"; layoutId: string }
  | { kind: "layout-kind-mismatch"; layoutId: string };

/**
 * Walks block definitions and layouts in both envs and emits a reason for
 * every divergence. An empty result means push/pull is safe.
 *
 * Block definitions: every text-keyed `blockId` must exist in both envs and
 * agree on `contentSchema`, `settingsSchema`, `layoutOnly`, and `synced`. Documentation
 * fields (`title`, `description`, `defaultContent`, `defaultSettings`) are
 * intentionally ignored — they don't affect content validity.
 *
 * Layouts: the set of text-keyed `layoutId`s must match exactly. Layouts have
 * no content schema of their own, but their kinds must also match.
 */
const collectCompatibilityReasons = Effect.fn("collectCompatibilityReasons")(function* (
  db: Database,
  sourceEnvId: number,
  targetEnvId: number,
) {
  const reasons: CompatibilityReason[] = [];

  const collection = yield* Effect.promise(() =>
    db
      .select({ id: collectionRecords.id })
      .from(collectionRecords)
      .innerJoin(
        collectionDefinitions,
        eq(collectionRecords.definitionId, collectionDefinitions.id),
      )
      .where(inArray(collectionDefinitions.environmentId, [sourceEnvId, targetEnvId]))
      .get(),
  );
  if (collection) reasons.push({ kind: "collections-replication-unsupported" });

  // --- Block definitions ---
  const sourceDefs = yield* Effect.promise(() =>
    db.select().from(blockDefinitions).where(eq(blockDefinitions.environmentId, sourceEnvId)),
  );
  const targetDefs = yield* Effect.promise(() =>
    db.select().from(blockDefinitions).where(eq(blockDefinitions.environmentId, targetEnvId)),
  );

  const sourceByKey = new Map(sourceDefs.map((def) => [def.blockId, def]));
  const targetByKey = new Map(targetDefs.map((def) => [def.blockId, def]));
  const allBlockKeys = new Set([...sourceByKey.keys(), ...targetByKey.keys()]);

  for (const blockId of allBlockKeys) {
    const src = sourceByKey.get(blockId);
    const tgt = targetByKey.get(blockId);
    if (!src) {
      reasons.push({ kind: "block-definition-missing-in-source", blockId });
      continue;
    }
    if (!tgt) {
      reasons.push({ kind: "block-definition-missing-in-target", blockId });
      continue;
    }
    if (stableStringify(src.contentSchema) !== stableStringify(tgt.contentSchema)) {
      reasons.push({ kind: "block-definition-schema-mismatch", blockId, field: "contentSchema" });
    }
    if (stableStringify(src.settingsSchema) !== stableStringify(tgt.settingsSchema)) {
      reasons.push({ kind: "block-definition-schema-mismatch", blockId, field: "settingsSchema" });
    }
    if ((src.synced ?? false) !== (tgt.synced ?? false)) {
      reasons.push({ kind: "block-definition-schema-mismatch", blockId, field: "synced" });
    }
    // `layoutOnly` is `boolean | null`; normalise null/undefined to compare.
    if ((src.layoutOnly ?? null) !== (tgt.layoutOnly ?? null)) {
      reasons.push({ kind: "block-definition-schema-mismatch", blockId, field: "layoutOnly" });
    }
  }

  // --- Layouts ---
  const sourceLayoutRows = yield* Effect.promise(() =>
    db
      .select({ layoutId: layouts.layoutId, kind: layouts.kind })
      .from(layouts)
      .where(eq(layouts.environmentId, sourceEnvId)),
  );
  const targetLayoutRows = yield* Effect.promise(() =>
    db
      .select({ layoutId: layouts.layoutId, kind: layouts.kind })
      .from(layouts)
      .where(eq(layouts.environmentId, targetEnvId)),
  );

  const sourceLayoutKeys = new Set(sourceLayoutRows.map((row) => row.layoutId));
  const targetLayoutKeys = new Set(targetLayoutRows.map((row) => row.layoutId));

  for (const layoutId of sourceLayoutKeys) {
    if (!targetLayoutKeys.has(layoutId)) {
      reasons.push({ kind: "layout-missing-in-target", layoutId });
    }
  }
  for (const source of sourceLayoutRows) {
    const target = targetLayoutRows.find((layout) => layout.layoutId === source.layoutId);
    if (target && source.kind !== target.kind)
      reasons.push({ kind: "layout-kind-mismatch", layoutId: source.layoutId });
  }
  for (const layoutId of targetLayoutKeys) {
    if (!sourceLayoutKeys.has(layoutId)) {
      reasons.push({ kind: "layout-missing-in-source", layoutId });
    }
  }

  return reasons;
});

// --- checkCompatibility ---

export const checkCompatibility = Effect.fn("environments.checkCompatibility")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof checkCompatibilityInput>,
) {
  const user = yield* requireUser(ctx);
  const { projectId, sourceEnvName, targetEnvName } = yield* decodeInput(
    checkCompatibilityInput,
    rawInput,
  );

  if (sourceEnvName === targetEnvName) {
    return yield* new InvalidInputError({
      message: "Source and target environments must differ",
    });
  }

  yield* getAuthorizedProject(ctx.db, projectId, user.id);

  const source = yield* resolveEnvironment(ctx.db, projectId, sourceEnvName);
  const target = yield* resolveEnvironment(ctx.db, projectId, targetEnvName);

  const reasons = yield* collectCompatibilityReasons(ctx.db, source.id, target.id);
  return { compatible: reasons.length === 0, reasons };
});

// --- Insertion-order helpers ---

/**
 * Orders pages root-first by `fullPath` depth, so any `parentPageId` we look
 * up in `pagesMap` was already inserted on a prior iteration.
 */
function sortPagesByDepth<T extends { fullPath: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.fullPath.split("/").length - b.fullPath.split("/").length);
}

/**
 * BFS from null-parent roots, so any `parentItemId` we look up in `itemsMap`
 * was already inserted on a prior iteration. Orphaned items (whose parent is
 * not in the input set) are appended at the end and will be remapped to a
 * null parent at insert time.
 */
function topoSortItems<T extends { id: number; parentItemId: number | null }>(items: T[]): T[] {
  const byParent = new Map<number | null, T[]>();
  for (const item of items) {
    const list = byParent.get(item.parentItemId) ?? [];
    list.push(item);
    byParent.set(item.parentItemId, list);
  }

  const sorted: T[] = [];
  const seen = new Set<number>();
  const queue: Array<number | null> = [null];
  while (queue.length > 0) {
    const parent = queue.shift() as number | null;
    const children = byParent.get(parent) ?? [];
    for (const child of children) {
      if (seen.has(child.id)) continue;
      sorted.push(child);
      seen.add(child.id);
      queue.push(child.id);
    }
  }
  // Pick up any items whose parent isn't in the input set; treat them as roots.
  for (const item of items) {
    if (!seen.has(item.id)) {
      sorted.push(item);
      seen.add(item.id);
    }
  }
  return sorted;
}

type IdMap = Map<number, number>;
const PAGE_TEXT_LINK_PREFIX = "camox:page:";

function remapNullableId(id: number | null, map: IdMap): number | null {
  if (id === null) return null;
  return map.get(id) ?? id;
}

function remapMaybeNullableId(id: number | null, map: IdMap): number | null {
  if (id === null) return null;
  return map.get(id) ?? null;
}

function remapMarkdownPageReferences(value: string, pagesMap: IdMap): string {
  return value.replaceAll(/camox:page:(\d+)/g, (match, pageId: string) => {
    const remapped = pagesMap.get(Number(pageId));
    if (remapped === undefined) return match;
    return `${PAGE_TEXT_LINK_PREFIX}${remapped}`;
  });
}

function remapPageReferences(value: JsonValue, pagesMap: IdMap): JsonValue {
  if (typeof value === "string") return remapMarkdownPageReferences(value, pagesMap);
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((entry) => remapPageReferences(entry, pagesMap));
  }

  const out: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "pageId" && typeof entry === "string") {
      const remapped = pagesMap.get(Number(entry));
      out[key] = remapped === undefined ? entry : String(remapped);
      continue;
    }
    out[key] = remapPageReferences(entry, pagesMap);
  }
  return out;
}

function remapContentReferences(value: unknown, filesMap: IdMap, pagesMap: IdMap) {
  const withFiles = remapFileReferences(value as JsonValue, filesMap);
  return remapPageReferences(withFiles, pagesMap);
}

function remapCheckpointContent(value: unknown, filesMap: IdMap, pagesMap: IdMap) {
  return remapContentReferences(value, filesMap, pagesMap);
}

// --- replicateEnvironment ---

export const replicateEnvironment = Effect.fn("environments.replicateEnvironment")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof replicateEnvironmentInput>,
) {
  const user = yield* requireUser(ctx);
  const { projectId, sourceEnvName, targetEnvName } = yield* decodeInput(
    replicateEnvironmentInput,
    rawInput,
  );

  if (sourceEnvName === targetEnvName) {
    return yield* new InvalidInputError({
      message: "Source and target environments must differ",
    });
  }

  // Phase 0 — authorize & resolve --------------------------------------------
  yield* getAuthorizedProject(ctx.db, projectId, user.id);

  const source = yield* resolveEnvironment(ctx.db, projectId, sourceEnvName);
  const target = yield* resolveEnvironment(ctx.db, projectId, targetEnvName);

  // Phase 1 — compatibility check --------------------------------------------
  const reasons = yield* collectCompatibilityReasons(ctx.db, source.id, target.id);
  if (reasons.length > 0) {
    return yield* new IncompatibleEnvironmentsError({ reasons });
  }

  // Phase 2 — snapshot the source environment --------------------------------
  // Read every env-scoped row, plus blocks/items via parent FKs. Empty source
  // is allowed and yields an empty snapshot (target ends up wiped).
  const sourceLayouts = yield* Effect.promise(() =>
    ctx.db.select().from(layouts).where(eq(layouts.environmentId, source.id)),
  );
  const sourceBlockDefs = yield* Effect.promise(() =>
    ctx.db.select().from(blockDefinitions).where(eq(blockDefinitions.environmentId, source.id)),
  );
  const sourceFiles = yield* Effect.promise(() =>
    ctx.db.select().from(files).where(eq(files.environmentId, source.id)),
  );
  const sourcePages = yield* Effect.promise(() =>
    ctx.db.select().from(pages).where(eq(pages.environmentId, source.id)),
  );
  const sourceComments = yield* Effect.promise(() =>
    ctx.db.select().from(comments).where(eq(comments.environmentId, source.id)),
  );

  const sourcePageIds = sourcePages.map((p) => p.id);
  const sourceLayoutPkIds = sourceLayouts.map((l) => l.id);

  // Blocks live under either a page or a layout. Skip the SQL entirely when
  // both parent sets are empty — `inArray(col, [])` would generate `IN ()`.
  let sourceBlocks: (typeof blocks.$inferSelect)[] = [];
  if (sourcePageIds.length > 0 && sourceLayoutPkIds.length > 0) {
    sourceBlocks = yield* Effect.promise(() =>
      ctx.db
        .select()
        .from(blocks)
        .where(
          or(inArray(blocks.pageId, sourcePageIds), inArray(blocks.layoutId, sourceLayoutPkIds)),
        ),
    );
  } else if (sourcePageIds.length > 0) {
    sourceBlocks = yield* Effect.promise(() =>
      ctx.db.select().from(blocks).where(inArray(blocks.pageId, sourcePageIds)),
    );
  } else if (sourceLayoutPkIds.length > 0) {
    sourceBlocks = yield* Effect.promise(() =>
      ctx.db.select().from(blocks).where(inArray(blocks.layoutId, sourceLayoutPkIds)),
    );
  }

  const sourceBlockIds = sourceBlocks.map((b) => b.id);
  const sourceItems: (typeof repeatableItems.$inferSelect)[] =
    sourceBlockIds.length > 0
      ? yield* Effect.promise(() =>
          ctx.db
            .select()
            .from(repeatableItems)
            .where(inArray(repeatableItems.blockId, sourceBlockIds)),
        )
      : [];
  const sourcePageCheckpoints =
    sourcePageIds.length > 0
      ? yield* Effect.promise(() =>
          ctx.db
            .select()
            .from(pageCheckpoints)
            .where(inArray(pageCheckpoints.pageId, sourcePageIds)),
        )
      : [];
  const sourceLayoutCheckpoints =
    sourceLayoutPkIds.length > 0
      ? yield* Effect.promise(() =>
          ctx.db
            .select()
            .from(layoutCheckpoints)
            .where(inArray(layoutCheckpoints.layoutId, sourceLayoutPkIds)),
        )
      : [];

  const takenAt = Date.now();
  const snapshot = {
    schemaVersion: 1 as const,
    takenAt,
    source: { envId: source.id, envName: source.name },
    target: { envId: target.id, envName: target.name },
    layouts: sourceLayouts,
    blockDefinitions: sourceBlockDefs,
    files: sourceFiles,
    pages: sourcePages,
    blocks: sourceBlocks,
    repeatableItems: sourceItems,
    comments: sourceComments,
    pageCheckpoints: sourcePageCheckpoints,
    layoutCheckpoints: sourceLayoutCheckpoints,
  };
  const snapshotKey = `${projectId}/env-snapshots/${target.name}/${takenAt}.json`;
  yield* Effect.promise(() =>
    ctx.env.FILES_BUCKET.put(snapshotKey, JSON.stringify(snapshot), {
      httpMetadata: { contentType: "application/json" },
    }),
  );

  // Phase 3 — wipe the target environment ------------------------------------
  // Order matters: pages must go before layouts (pages.layout_id has no
  // ON DELETE CASCADE), and the files DELETE bypasses the per-row service so
  // R2 blobs are preserved for re-insertion below.
  const targetPages = yield* Effect.promise(() =>
    ctx.db.select().from(pages).where(eq(pages.environmentId, target.id)),
  );
  const targetLayouts = yield* Effect.promise(() =>
    ctx.db.select().from(layouts).where(eq(layouts.environmentId, target.id)),
  );
  const targetPageIds = targetPages.map((p) => p.id);
  const targetLayoutIds = targetLayouts.map((l) => l.id);
  yield* Effect.promise(() => ctx.db.delete(comments).where(eq(comments.environmentId, target.id)));
  if (targetPageIds.length > 0) {
    yield* Effect.promise(() =>
      ctx.db.delete(pageCheckpoints).where(inArray(pageCheckpoints.pageId, targetPageIds)),
    );
  }
  if (targetLayoutIds.length > 0) {
    yield* Effect.promise(() =>
      ctx.db.delete(layoutCheckpoints).where(inArray(layoutCheckpoints.layoutId, targetLayoutIds)),
    );
  }
  yield* Effect.promise(() => ctx.db.delete(pages).where(eq(pages.environmentId, target.id)));
  yield* Effect.promise(() => ctx.db.delete(layouts).where(eq(layouts.environmentId, target.id)));
  yield* Effect.promise(() =>
    ctx.db.delete(blockDefinitions).where(eq(blockDefinitions.environmentId, target.id)),
  );
  yield* Effect.promise(() => ctx.db.delete(files).where(eq(files.environmentId, target.id)));

  // Phase 4 — re-insert into target, with ID remapping -----------------------

  const layoutsMap = new Map<number, number>();
  for (const row of sourceLayouts) {
    const { id, environmentId: _envId, livePublishedCheckpointId: _liveCk, ...rest } = row;
    const inserted = yield* Effect.promise(() =>
      ctx.db
        .insert(layouts)
        .values({ ...rest, environmentId: target.id, livePublishedCheckpointId: null })
        .returning()
        .get(),
    );
    layoutsMap.set(id, inserted.id);
  }

  // Block definitions have no incoming FKs from env-scoped tables, so there's
  // nothing to remap after insert.
  for (const row of sourceBlockDefs) {
    const { id: _id, environmentId: _envId, ...rest } = row;
    yield* Effect.promise(() =>
      ctx.db.insert(blockDefinitions).values({ ...rest, environmentId: target.id }),
    );
  }

  // Files: `blobId`, `path`, `url`, etc. are copied verbatim. Multiple rows
  // pointing at the same R2 object is intentional — refcount-aware deletion
  // (Phase 1) keeps blobs alive while any env still references them.
  const filesMap = new Map<number, number>();
  for (const row of sourceFiles) {
    const { id, environmentId: _envId, ...rest } = row;
    const inserted = yield* Effect.promise(() =>
      ctx.db
        .insert(files)
        .values({ ...rest, environmentId: target.id })
        .returning()
        .get(),
    );
    filesMap.set(id, inserted.id);
  }

  const pagesMap = new Map<number, number>();
  for (const row of sortPagesByDepth(sourcePages)) {
    const {
      id,
      environmentId: _envId,
      parentPageId,
      layoutId,
      livePublishedCheckpointId: _liveCk,
      ...rest
    } = row;
    const newLayoutId = layoutsMap.get(layoutId);
    if (newLayoutId === undefined) {
      return yield* Effect.die(
        new Error(`Page ${id} references missing layout ${layoutId} during replication.`),
      );
    }
    const newParentPageId = parentPageId !== null ? (pagesMap.get(parentPageId) ?? null) : null;
    const inserted = yield* Effect.promise(() =>
      ctx.db
        .insert(pages)
        .values({
          ...rest,
          environmentId: target.id,
          parentPageId: newParentPageId,
          layoutId: newLayoutId,
          livePublishedCheckpointId: null,
        })
        .returning()
        .get(),
    );
    pagesMap.set(id, inserted.id);
  }

  const blocksMap = new Map<number, number>();
  for (const row of sourceBlocks) {
    const { id, pageId, layoutId, content, settings, ...rest } = row;
    const newPageId = pageId !== null ? (pagesMap.get(pageId) ?? null) : null;
    const newLayoutId = layoutId !== null ? (layoutsMap.get(layoutId) ?? null) : null;
    const newContent = remapContentReferences(content, filesMap, pagesMap);
    const newSettings =
      settings !== null && settings !== undefined
        ? remapContentReferences(settings, filesMap, pagesMap)
        : settings;
    const inserted = yield* Effect.promise(() =>
      ctx.db
        .insert(blocks)
        .values({
          ...rest,
          pageId: newPageId,
          layoutId: newLayoutId,
          content: newContent,
          settings: newSettings,
        })
        .returning()
        .get(),
    );
    blocksMap.set(id, inserted.id);
  }

  const itemsMap = new Map<number, number>();
  for (const row of topoSortItems(sourceItems)) {
    const { id, blockId, parentItemId, content, settings, ...rest } = row;
    const newBlockId = blocksMap.get(blockId);
    if (newBlockId === undefined) {
      return yield* Effect.die(
        new Error(`Repeatable item ${id} references missing block ${blockId} during replication.`),
      );
    }
    const newParentItemId = parentItemId !== null ? (itemsMap.get(parentItemId) ?? null) : null;
    const newContent = remapContentReferences(content, filesMap, pagesMap);
    const newSettings =
      settings !== null && settings !== undefined
        ? remapContentReferences(settings, filesMap, pagesMap)
        : settings;
    const inserted = yield* Effect.promise(() =>
      ctx.db
        .insert(repeatableItems)
        .values({
          ...rest,
          blockId: newBlockId,
          parentItemId: newParentItemId,
          content: newContent,
          settings: newSettings,
        })
        .returning()
        .get(),
    );
    itemsMap.set(id, inserted.id);
  }

  // Comments are new identities in the destination, but retain their provenance.
  for (const row of sourceComments) {
    const pageId = pagesMap.get(row.pageId);
    const blockId = row.blockId === null ? null : blocksMap.get(row.blockId);
    const itemId = row.itemId === null ? null : itemsMap.get(row.itemId);
    if (pageId === undefined) {
      return yield* Effect.die(new Error("Comment target could not be remapped"));
    }
    const available =
      row.target &&
      (!("blockId" in row.target) || blockId != null) &&
      (!("itemId" in row.target) || itemId != null);
    const remappedTarget = available
      ? {
          ...row.target!,
          ...("blockId" in row.target! ? { blockId: blockId! } : {}),
          ...("itemId" in row.target! ? { itemId: itemId! } : {}),
        }
      : null;
    yield* Effect.promise(() =>
      ctx.db.insert(comments).values({
        ...row,
        id: crypto.randomUUID(),
        environmentId: target.id,
        pageId,
        blockId: blockId ?? null,
        itemId: itemId ?? null,
        target: remappedTarget,
      }),
    );
  }

  // Shared published values can outlive their original placement. Remap them
  // separately from draft rows and page/layout checkpoint pointers.
  for (const definition of sourceBlockDefs) {
    const shared = definition.syncedPublishedData;
    if (!shared) continue;
    const remapData = (value: unknown) => remapCheckpointContent(value, filesMap, pagesMap);
    yield* Effect.promise(() =>
      ctx.db
        .update(blockDefinitions)
        .set({
          syncedPublishedData: {
            block: {
              ...shared.block,
              id: blocksMap.get(shared.block.id) ?? shared.block.id,
              pageId: remapMaybeNullableId(shared.block.pageId, pagesMap),
              layoutId: remapMaybeNullableId(shared.block.layoutId, layoutsMap),
              content: remapData(shared.block.content),
              settings: remapData(shared.block.settings),
            },
            items: shared.items.map((item) => ({
              ...item,
              id: itemsMap.get(item.id) ?? item.id,
              blockId: blocksMap.get(item.blockId) ?? item.blockId,
              parentItemId: remapNullableId(item.parentItemId, itemsMap),
              content: remapData(item.content),
              settings: remapData(item.settings),
            })),
          },
        })
        .where(
          and(
            eq(blockDefinitions.environmentId, target.id),
            eq(blockDefinitions.blockId, definition.blockId),
          ),
        ),
    );
  }

  const layoutCheckpointsMap = new Map<number, number>();
  for (const row of sourceLayoutCheckpoints) {
    const { id, layoutId, snapshot: rawSnapshot, ...rest } = row;
    const newLayoutId = layoutsMap.get(layoutId);
    if (newLayoutId === undefined) continue;

    const parsed = layoutSnapshotSchema.parse(JSON.parse(rawSnapshot));
    const remappedSnapshot = {
      ...parsed,
      layout: {
        ...parsed.layout,
        id: newLayoutId,
        environmentId: target.id,
      },
      blocks: parsed.blocks.map((block) => ({
        ...block,
        id: blocksMap.get(block.id) ?? block.id,
        pageId: remapMaybeNullableId(block.pageId, pagesMap),
        layoutId: remapMaybeNullableId(block.layoutId, layoutsMap),
        content: remapCheckpointContent(block.content, filesMap, pagesMap),
        settings:
          block.settings !== null
            ? remapCheckpointContent(block.settings, filesMap, pagesMap)
            : block.settings,
      })),
      repeatableItems: parsed.repeatableItems.map((item) => ({
        ...item,
        id: itemsMap.get(item.id) ?? item.id,
        blockId: blocksMap.get(item.blockId) ?? item.blockId,
        parentItemId: remapNullableId(item.parentItemId, itemsMap),
        content: remapCheckpointContent(item.content, filesMap, pagesMap),
        settings:
          item.settings !== null
            ? remapCheckpointContent(item.settings, filesMap, pagesMap)
            : item.settings,
      })),
    };

    const inserted = yield* Effect.promise(() =>
      ctx.db
        .insert(layoutCheckpoints)
        .values({ ...rest, layoutId: newLayoutId, snapshot: JSON.stringify(remappedSnapshot) })
        .returning()
        .get(),
    );
    layoutCheckpointsMap.set(id, inserted.id);
  }

  const pageCheckpointsMap = new Map<number, number>();
  for (const row of sourcePageCheckpoints) {
    const { id, pageId, snapshot: rawSnapshot, ...rest } = row;
    const newPageId = pagesMap.get(pageId);
    if (newPageId === undefined) continue;

    const parsed = pageSnapshotSchema.parse(JSON.parse(rawSnapshot));
    const remappedSnapshot = {
      ...parsed,
      page: {
        ...parsed.page,
        id: newPageId,
        environmentId: target.id,
        parentPageId: remapMaybeNullableId(parsed.page.parentPageId, pagesMap),
        layoutId: layoutsMap.get(parsed.page.layoutId) ?? parsed.page.layoutId,
      },
      blocks: parsed.blocks.map((block) => ({
        ...block,
        id: blocksMap.get(block.id) ?? block.id,
        pageId: remapMaybeNullableId(block.pageId, pagesMap),
        layoutId: remapMaybeNullableId(block.layoutId, layoutsMap),
        content: remapCheckpointContent(block.content, filesMap, pagesMap),
        settings:
          block.settings !== null
            ? remapCheckpointContent(block.settings, filesMap, pagesMap)
            : block.settings,
      })),
      repeatableItems: parsed.repeatableItems.map((item) => ({
        ...item,
        id: itemsMap.get(item.id) ?? item.id,
        blockId: blocksMap.get(item.blockId) ?? item.blockId,
        parentItemId: remapNullableId(item.parentItemId, itemsMap),
        content: remapCheckpointContent(item.content, filesMap, pagesMap),
        settings:
          item.settings !== null
            ? remapCheckpointContent(item.settings, filesMap, pagesMap)
            : item.settings,
      })),
    };

    const inserted = yield* Effect.promise(() =>
      ctx.db
        .insert(pageCheckpoints)
        .values({ ...rest, pageId: newPageId, snapshot: JSON.stringify(remappedSnapshot) })
        .returning()
        .get(),
    );
    pageCheckpointsMap.set(id, inserted.id);
  }

  for (const sourceLayout of sourceLayouts) {
    if (sourceLayout.livePublishedCheckpointId === null) continue;
    const newLayoutId = layoutsMap.get(sourceLayout.id);
    const newCheckpointId = layoutCheckpointsMap.get(sourceLayout.livePublishedCheckpointId);
    if (newLayoutId === undefined || newCheckpointId === undefined) continue;
    yield* Effect.promise(() =>
      ctx.db
        .update(layouts)
        .set({ livePublishedCheckpointId: newCheckpointId })
        .where(eq(layouts.id, newLayoutId)),
    );
  }

  for (const sourcePage of sourcePages) {
    if (sourcePage.livePublishedCheckpointId === null) continue;
    const newPageId = pagesMap.get(sourcePage.id);
    const newCheckpointId = pageCheckpointsMap.get(sourcePage.livePublishedCheckpointId);
    if (newPageId === undefined || newCheckpointId === undefined) continue;
    yield* Effect.promise(() =>
      ctx.db
        .update(pages)
        .set({ livePublishedCheckpointId: newCheckpointId })
        .where(eq(pages.id, newPageId)),
    );
  }

  // Phase 5 — broadcast invalidation -----------------------------------------
  // The project room is shared across envs; sessions on the source env will
  // refetch unchanged data (a no-op), and sessions on the target env will
  // pick up the new content.
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId,
    targets: [
      queryKeys.pages.list,
      queryKeys.pages.getByPathAll,
      queryKeys.files.list,
      queryKeys.layouts.all,
      queryKeys.blocks.getUsageCounts,
      queryKeys.environments.checkCompatibility,
      queryKeys.comments.all,
    ],
  });

  return {
    source: { id: source.id, name: source.name },
    target: { id: target.id, name: target.name },
    copied: {
      layouts: sourceLayouts.length,
      blockDefinitions: sourceBlockDefs.length,
      files: sourceFiles.length,
      pages: sourcePages.length,
      blocks: sourceBlocks.length,
      repeatableItems: sourceItems.length,
      comments: sourceComments.length,
      pageCheckpoints: sourcePageCheckpoints.length,
      layoutCheckpoints: sourceLayoutCheckpoints.length,
    },
    snapshotKey,
  };
});
