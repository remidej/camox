import { queryKeys } from "@camox/api-contract/query-keys";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import { assertLayoutAccess, assertSyncAccess } from "../../authorization";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { resolveEnvironment } from "../../lib/resolve-environment";
import {
  blockDefinitions,
  blocks,
  layoutCheckpoints,
  layouts,
  pages,
  projects,
  repeatableItems,
} from "../../schema";
import { injectRepeatableItemMarkers } from "../_shared/block-markers";
import { readLayoutSnapshot } from "../_shared/layout-source";
import type { ServiceContext } from "../_shared/service-context";
import type { LayoutSnapshot } from "../_shared/snapshot-schemas";
import { syncBlockData } from "../blocks/synced";
import { publishSyncedData } from "../blocks/synced-live";
import { buildFileMap, collectFileIds, sortByPosition } from "../pages/ai";

// --- Input Schemas ---
// Exported so adapters (oRPC, MCP, CLI) share the same canonical contract.
// Services .parse() them on entry — service is the trust boundary.

export const getLayoutInput = z.object({
  projectSlug: z.string(),
  layoutId: z.string(),
  source: z.enum(["live", "draft"]).default("live"),
});

export const listLayoutsInput = z.object({ projectId: z.number() });
export const publishLayoutInput = z.object({ id: z.number() });
export const unpublishLayoutInput = z.object({ id: z.number() });

// Snapshot shape version written into `layout_checkpoints.schema_version`.
// One-way ratchet — bump and add a migration when the snapshot shape changes.
const LAYOUT_SNAPSHOT_SCHEMA_VERSION = 1;

function assertUser(ctx: ServiceContext) {
  if (!ctx.user) throw new ORPCError("UNAUTHORIZED");
  return ctx.user;
}

const repeatableItemSeedSchema = z.object({
  tempId: z.string(),
  parentTempId: z.string().nullable(),
  fieldName: z.string(),
  content: z.unknown(),
  position: z.string(),
});

export const syncLayoutsInput = z.object({
  projectSlug: z.string(),
  deployToken: z.string().optional(),
  autoCreate: z.boolean(),
  layouts: z.array(
    z.object({
      layoutId: z.string(),
      description: z.string(),
      blocks: z.array(
        z.object({
          type: z.string(),
          content: z.unknown(),
          settings: z.unknown().optional(),
          placement: z.enum(["before", "after"]).optional(),
          repeatableItems: z.array(repeatableItemSeedSchema).optional(),
        }),
      ),
    }),
  ),
});

// --- Derived publish status ---
//
// Layout status mirrors page status (Phase 2 / Phase 3) but without a cascade:
// a layout has no parent. `'draft'` when there's no live pointer, `'modified'`
// when the live row has moved past the published checkpoint, `'published'`
// otherwise. Computed at read time; nothing stored.

export type LayoutStatus = "draft" | "published" | "modified";
export type LayoutStatusInfo = {
  status: LayoutStatus;
  affectedPagesCount: number;
};

type LayoutRow = typeof layouts.$inferSelect;

function deriveLayoutStatus(args: {
  layout: Pick<LayoutRow, "livePublishedCheckpointId" | "contentUpdatedAt">;
  checkpointCreatedAt: number | null;
  affectedPagesCount: number;
}): LayoutStatusInfo {
  const { layout, checkpointCreatedAt, affectedPagesCount } = args;
  if (layout.livePublishedCheckpointId == null || checkpointCreatedAt == null) {
    return { status: "draft", affectedPagesCount };
  }
  if (layout.contentUpdatedAt > checkpointCreatedAt) {
    return { status: "modified", affectedPagesCount };
  }
  return { status: "published", affectedPagesCount };
}

async function fetchLayoutStatuses(
  ctx: ServiceContext,
  layoutRows: LayoutRow[],
  environmentId: number,
): Promise<Map<number, LayoutStatusInfo>> {
  const result = new Map<number, LayoutStatusInfo>();
  if (layoutRows.length === 0) return result;
  const db = ctx.db;

  const checkpointIds = layoutRows
    .map((l) => l.livePublishedCheckpointId)
    .filter((id): id is number => id != null);
  const checkpointCreatedAt = new Map<number, number>();
  if (checkpointIds.length > 0) {
    const rows = await db
      .select({ id: layoutCheckpoints.id, createdAt: layoutCheckpoints.createdAt })
      .from(layoutCheckpoints)
      .where(inArray(layoutCheckpoints.id, checkpointIds));
    for (const row of rows) checkpointCreatedAt.set(row.id, row.createdAt);
  }

  // One GROUP BY for "how many pages use each layout" — same shape as
  // fetchPageStatuses uses for the cascade tooltip.
  const layoutIds = layoutRows.map((l) => l.id);
  const pageCounts = new Map<number, number>();
  const rows = await db
    .select({ layoutId: pages.layoutId, count: sql<number>`count(*)` })
    .from(pages)
    .where(and(eq(pages.environmentId, environmentId), inArray(pages.layoutId, layoutIds)))
    .groupBy(pages.layoutId);
  for (const row of rows) {
    if (row.layoutId != null) pageCounts.set(row.layoutId, Number(row.count));
  }

  for (const layout of layoutRows) {
    const cpAt =
      layout.livePublishedCheckpointId != null
        ? (checkpointCreatedAt.get(layout.livePublishedCheckpointId) ?? null)
        : null;
    result.set(
      layout.id,
      deriveLayoutStatus({
        layout,
        checkpointCreatedAt: cpAt,
        affectedPagesCount: pageCounts.get(layout.id) ?? 0,
      }),
    );
  }

  return result;
}

// --- Snapshot ---

// Build a canonical layout snapshot from the current live (draft) rows. Mirrors
// `buildPageSnapshotFromDraft` — same `_itemId` markers convention (stripped
// on write, re-injected on read), same blocks + repeatableItems shape.
export async function buildLayoutSnapshotFromDraft(
  ctx: ServiceContext,
  layout: typeof layouts.$inferSelect,
): Promise<LayoutSnapshot> {
  const layoutBlocks = await ctx.db.select().from(blocks).where(eq(blocks.layoutId, layout.id));
  const blockIds = layoutBlocks.map((b) => b.id);
  const items =
    blockIds.length > 0
      ? await ctx.db
          .select()
          .from(repeatableItems)
          .where(inArray(repeatableItems.blockId, blockIds))
      : [];

  return {
    layout: {
      id: layout.id,
      projectId: layout.projectId,
      environmentId: layout.environmentId,
      layoutId: layout.layoutId,
      description: layout.description,
      createdAt: layout.createdAt,
      updatedAt: layout.updatedAt,
    },
    blocks: layoutBlocks.map((b) => ({
      id: b.id,
      pageId: b.pageId,
      layoutId: b.layoutId,
      type: b.type,
      content: b.content,
      settings: b.settings,
      placement: b.placement,
      summary: b.summary,
      position: b.position,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    })),
    repeatableItems: items.map((item) => ({
      id: item.id,
      blockId: item.blockId,
      parentItemId: item.parentItemId,
      fieldName: item.fieldName,
      content: item.content,
      settings: item.settings,
      summary: item.summary,
      position: item.position,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  };
}

// A layout publish affects every page using that layout — the page list needs
// to recompute status for all of them, and the per-page `'live'` caches need
// to refresh. We enumerate the affected pages and their blocks once, then fan
// out a single broadcast. `pages.getByPath` without a source is a prefix that
// covers both 'draft' and 'live' slots, which matters: the draft slot also
// re-derives status from the layout pointer.
async function invalidateLayoutPublish(
  ctx: ServiceContext,
  args: {
    projectId: number;
    environmentId: number;
    layoutId: number;
  },
) {
  const dependentPages = await ctx.db
    .select({ id: pages.id, fullPath: pages.fullPath })
    .from(pages)
    .where(and(eq(pages.layoutId, args.layoutId), eq(pages.environmentId, args.environmentId)));

  const pageIds = dependentPages.map((p) => p.id);
  const pageBlockIds =
    pageIds.length > 0
      ? (
          await ctx.db.select({ id: blocks.id }).from(blocks).where(inArray(blocks.pageId, pageIds))
        ).map((b) => b.id)
      : [];

  const layoutBlockIds = (
    await ctx.db.select({ id: blocks.id }).from(blocks).where(eq(blocks.layoutId, args.layoutId))
  ).map((b) => b.id);

  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: args.projectId,
    targets: [
      queryKeys.pages.list,
      queryKeys.layouts.all,
      // Synced block types may also be used by unrelated layouts or pages.
      queryKeys.pages.getByPathAll,
      ["camox", "blocks", "get"],
      ["camox", "blocks", "getPageMarkdown"],
      ...dependentPages.map((p) => queryKeys.pages.getByPath(p.fullPath)),
      ...pageBlockIds.map((id) => queryKeys.blocks.get(id, "live")),
      ...layoutBlockIds.map((id) => queryKeys.blocks.get(id, "live")),
    ],
  });
}

// --- Reads ---

export async function listLayouts(ctx: ServiceContext, rawInput: z.input<typeof listLayoutsInput>) {
  const { projectId } = listLayoutsInput.parse(rawInput);
  const environment = await resolveEnvironment(ctx.db, projectId, ctx.environmentName);
  const rows = await ctx.db
    .select()
    .from(layouts)
    .where(and(eq(layouts.projectId, projectId), eq(layouts.environmentId, environment.id)));
  const statuses = await fetchLayoutStatuses(ctx, rows, environment.id);
  return rows.map((layout) => ({
    ...layout,
    ...(statuses.get(layout.id) ?? { status: "draft" as const, affectedPagesCount: 0 }),
  }));
}

// Standalone layout reads use the same persisted blocks and live checkpoints as curated pages.
export async function getLayout(ctx: ServiceContext, rawInput: z.input<typeof getLayoutInput>) {
  const { projectSlug, layoutId, source } = getLayoutInput.parse(rawInput);
  const user = source === "draft" ? assertUser(ctx) : null;
  const project = await ctx.db.select().from(projects).where(eq(projects.slug, projectSlug)).get();
  if (!project) throw new ORPCError("NOT_FOUND");
  const environment = await resolveEnvironment(ctx.db, project.id, ctx.environmentName);
  const layout = await ctx.db
    .select()
    .from(layouts)
    .where(and(eq(layouts.environmentId, environment.id), eq(layouts.layoutId, layoutId)))
    .get();
  if (!layout) throw new ORPCError("NOT_FOUND");
  if (user) await assertLayoutAccess(ctx.db, layout.id, user.id);

  const snapshot =
    source === "draft"
      ? await buildLayoutSnapshotFromDraft(ctx, layout)
      : await readLayoutSnapshot(ctx, layout);
  const layoutBlocks = sortByPosition(snapshot?.blocks ?? []);
  const items = sortByPosition(snapshot?.repeatableItems ?? []);
  const normalized = layoutBlocks.map((block) =>
    injectRepeatableItemMarkers(
      block,
      items.filter((item) => item.blockId === block.id),
    ),
  );
  const fileIds = new Set<number>();
  for (const value of [...layoutBlocks, ...items])
    collectFileIds(value.content as Record<string, unknown>, fileIds);
  const fileRows = await buildFileMap(ctx.db, fileIds);
  return {
    layout: {
      id: layout.id,
      layoutId: layout.layoutId,
      contentUpdatedAt: layout.contentUpdatedAt,
      updatedAt: layout.updatedAt,
      livePublishedCheckpointId: layout.livePublishedCheckpointId,
      beforeBlockIds: layoutBlocks
        .filter((block) => block.placement === "before")
        .map((block) => block.id),
      afterBlockIds: layoutBlocks
        .filter((block) => block.placement === "after")
        .map((block) => block.id),
    },
    blocks: normalized.map(({ block }) => block),
    repeatableItems: normalized.flatMap(({ items }) => items),
    files: [...fileRows.values()],
  };
}

// --- Writes ---

export async function syncLayouts(ctx: ServiceContext, rawInput: z.input<typeof syncLayoutsInput>) {
  const input = syncLayoutsInput.parse(rawInput);
  const { projectSlug, layouts: layoutDefs, autoCreate } = input;
  const project = await assertSyncAccess(ctx.db, projectSlug, {
    user: ctx.user,
    environmentName: ctx.environmentName,
    deployToken: input.deployToken,
  });
  const projectId = project.id;
  const environment = await resolveEnvironment(ctx.db, projectId, ctx.environmentName, {
    autoCreate,
  });
  const now = Date.now();
  const results = [];

  const layoutOnlyDefs = await ctx.db
    .select({ blockId: blockDefinitions.blockId })
    .from(blockDefinitions)
    .where(
      and(
        eq(blockDefinitions.projectId, projectId),
        eq(blockDefinitions.environmentId, environment.id),
        eq(blockDefinitions.layoutOnly, true),
      ),
    );
  const layoutOnlyTypes = new Set(layoutOnlyDefs.map((d) => d.blockId));

  for (const def of layoutDefs) {
    const existingLayout = await ctx.db
      .select()
      .from(layouts)
      .where(
        and(
          eq(layouts.projectId, projectId),
          eq(layouts.environmentId, environment.id),
          eq(layouts.layoutId, def.layoutId),
        ),
      )
      .get();

    const layout = existingLayout
      ? await ctx.db
          .update(layouts)
          .set({ description: def.description, updatedAt: now })
          .where(eq(layouts.id, existingLayout.id))
          .returning()
          .get()
      : await ctx.db
          .insert(layouts)
          .values({
            projectId,
            environmentId: environment.id,
            layoutId: def.layoutId,
            description: def.description,
            contentUpdatedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();

    const createdBlockTypes: string[] = [];

    // Before/after blocks can only be declared in code — the UI can't create
    // them — so every sync must backfill any declared block slot missing from
    // the DB. Never overwrite an existing block: users may have edited its
    // content in the UI.
    const existingBlocks = await ctx.db
      .select({
        id: blocks.id,
        type: blocks.type,
        placement: blocks.placement,
        position: blocks.position,
      })
      .from(blocks)
      .where(eq(blocks.layoutId, layout.id));

    const existingByKey = new Map<string, string>();
    for (const b of existingBlocks) {
      existingByKey.set(`${b.type}:${b.placement ?? ""}`, b.position);
    }

    const slots = def.blocks.map((blockDef) => ({
      def: blockDef,
      position: existingByKey.get(`${blockDef.type}:${blockDef.placement ?? ""}`) ?? null,
    }));

    let lastPos: string | null = null;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot.position !== null) {
        lastPos = slot.position;
        continue;
      }

      let nextPos: string | null = null;
      for (let j = i + 1; j < slots.length; j++) {
        if (slots[j].position !== null) {
          nextPos = slots[j].position;
          break;
        }
      }

      const newPos = generateKeyBetween(lastPos, nextPos);
      const blockDef = slot.def;
      createdBlockTypes.push(blockDef.type);

      const block = await ctx.db
        .insert(blocks)
        .values({
          layoutId: layout.id,
          type: blockDef.type,
          content: blockDef.content,
          settings: blockDef.settings ?? null,
          placement: blockDef.placement ?? null,
          position: newPos,
          summary: "",
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();

      const itemSeeds = blockDef.repeatableItems;
      if (itemSeeds && itemSeeds.length > 0) {
        const tempIdToRealId = new Map<string, number>();
        for (const seed of itemSeeds) {
          const parentItemId = seed.parentTempId
            ? (tempIdToRealId.get(seed.parentTempId) ?? null)
            : null;
          const inserted = await ctx.db
            .insert(repeatableItems)
            .values({
              blockId: block.id,
              parentItemId,
              fieldName: seed.fieldName,
              content: seed.content,
              summary: "",
              position: seed.position,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get();
          tempIdToRealId.set(seed.tempId, inserted.id);
        }
      }

      await syncBlockData(ctx, block.id, true);
      slot.position = newPos;
      lastPos = newPos;
    }

    const declaredKeys = new Set(def.blocks.map((bd) => `${bd.type}:${bd.placement ?? ""}`));
    const removedBlockTypes: string[] = [];
    const skippedOrphanTypes: string[] = [];
    const orphanIdsToDelete: number[] = [];
    for (const existing of existingBlocks) {
      const key = `${existing.type}:${existing.placement ?? ""}`;
      if (declaredKeys.has(key)) continue;
      if (layoutOnlyTypes.has(existing.type)) {
        orphanIdsToDelete.push(existing.id);
        removedBlockTypes.push(existing.type);
      } else {
        skippedOrphanTypes.push(existing.type);
      }
    }
    if (orphanIdsToDelete.length > 0) {
      await ctx.db.delete(blocks).where(inArray(blocks.id, orphanIdsToDelete));
    }

    results.push({
      layout,
      wasExisting: Boolean(existingLayout),
      createdBlockTypes,
      removedBlockTypes,
      skippedOrphanTypes,
    });
  }

  const submittedLayoutIds = layoutDefs.map((d) => d.layoutId);
  const orphanLayoutQuery = ctx.db
    .select({ id: layouts.id, layoutId: layouts.layoutId })
    .from(layouts);
  const orphanLayouts =
    submittedLayoutIds.length > 0
      ? await orphanLayoutQuery.where(
          and(
            eq(layouts.projectId, projectId),
            eq(layouts.environmentId, environment.id),
            notInArray(layouts.layoutId, submittedLayoutIds),
          ),
        )
      : await orphanLayoutQuery.where(
          and(eq(layouts.projectId, projectId), eq(layouts.environmentId, environment.id)),
        );

  const deletedLayoutIds: string[] = [];
  const blockedLayoutDeletions: Array<{ layoutId: string; pageCount: number }> = [];
  for (const orphan of orphanLayouts) {
    const pagesUsing = await ctx.db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.layoutId, orphan.id), eq(pages.environmentId, environment.id)));
    if (pagesUsing.length > 0) {
      blockedLayoutDeletions.push({ layoutId: orphan.layoutId, pageCount: pagesUsing.length });
      continue;
    }
    await ctx.db.delete(layouts).where(eq(layouts.id, orphan.id));
    deletedLayoutIds.push(orphan.layoutId);
  }

  // A layoutOnly block definition only makes sense while at least one
  // layout-scoped `blocks` row references it. Once the last reference is
  // pruned (either via orphan cleanup above or layout deletion), drop the
  // definition too so the DB doesn't accumulate UI-invisible rows.
  const usedTypes = await ctx.db
    .selectDistinct({ type: blocks.type })
    .from(blocks)
    .innerJoin(layouts, eq(blocks.layoutId, layouts.id))
    .where(eq(layouts.environmentId, environment.id));
  const usedTypeSet = new Set(usedTypes.map((r) => r.type));

  const deletedDefinitionTypes: string[] = [];
  for (const layoutOnlyType of layoutOnlyTypes) {
    if (!usedTypeSet.has(layoutOnlyType)) {
      deletedDefinitionTypes.push(layoutOnlyType);
    }
  }
  if (deletedDefinitionTypes.length > 0) {
    await ctx.db
      .delete(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, projectId),
          eq(blockDefinitions.environmentId, environment.id),
          inArray(blockDefinitions.blockId, deletedDefinitionTypes),
        ),
      );
  }

  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId,
    targets: [queryKeys.layouts.all, queryKeys.pages.getByPathAll],
  });

  return {
    layouts: results,
    deletedLayoutIds,
    blockedLayoutDeletions,
    deletedDefinitionTypes,
  };
}

// Promote the current layout draft to public: snapshot the live rows, write a
// new auto-publish checkpoint, point the layout at it. Mirrors `publishPage`.
// `pages.publish` also reaches for these primitives when `alsoPublishLayout`
// is set, so the building blocks are exported.
export async function publishLayout(
  ctx: ServiceContext,
  rawInput: z.input<typeof publishLayoutInput>,
) {
  const user = assertUser(ctx);
  const { id } = publishLayoutInput.parse(rawInput);
  const access = await assertLayoutAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  const layoutRow = await ctx.db.select().from(layouts).where(eq(layouts.id, id)).get();
  if (!layoutRow) throw new ORPCError("NOT_FOUND");

  await writeLayoutCheckpointAndPoint(ctx, { layout: layoutRow, userId: user.id });

  await invalidateLayoutPublish(ctx, {
    projectId: access.projectId,
    environmentId: layoutRow.environmentId,
    layoutId: id,
  });

  const updated = await ctx.db.select().from(layouts).where(eq(layouts.id, id)).get();
  return updated;
}

// The insert+pointer-update pair, factored so `pages.publish` can reuse it in
// the bundled-publish path. D1 + drizzle has no shared-transaction primitive;
// a partial failure between the two steps leaves a checkpoint nothing points
// at, which is harmless history that no UI surfaces. Same trade-off as page.
//
// `userId` is null for production releases, which authenticate with a deploy
// token rather than a user session; this also matches the migration backfill.
export async function writeLayoutCheckpointAndPoint(
  ctx: ServiceContext,
  args: { layout: typeof layouts.$inferSelect; userId: string | null },
) {
  const snapshot = await buildLayoutSnapshotFromDraft(ctx, args.layout);
  const now = Date.now();
  const checkpoint = await ctx.db
    .insert(layoutCheckpoints)
    .values({
      layoutId: args.layout.id,
      kind: "auto-publish",
      label: null,
      snapshot: JSON.stringify(snapshot),
      schemaVersion: LAYOUT_SNAPSHOT_SCHEMA_VERSION,
      createdAt: now,
      createdBy: args.userId,
    })
    .returning()
    .get();

  await ctx.db
    .update(layouts)
    .set({ livePublishedCheckpointId: checkpoint.id, updatedAt: now })
    .where(eq(layouts.id, args.layout.id));

  await publishSyncedData(ctx, args.layout.environmentId, snapshot);
  return { checkpoint, snapshot };
}

// Clear the live pointer. Every page using this layout will fall back to
// rendering without layout blocks on its public reads — see
// `readLayoutSnapshot` in pages/service.ts: a null pointer returns null,
// composePageView then passes an empty `layoutBlocks` to the renderer.
// The draft is untouched; the previous auto-publish checkpoint stays in the
// DB so a future history-sidebar feature can re-point at it.
export async function unpublishLayout(
  ctx: ServiceContext,
  rawInput: z.input<typeof unpublishLayoutInput>,
) {
  const user = assertUser(ctx);
  const { id } = unpublishLayoutInput.parse(rawInput);
  const access = await assertLayoutAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  const layoutRow = await ctx.db.select().from(layouts).where(eq(layouts.id, id)).get();
  if (!layoutRow) throw new ORPCError("NOT_FOUND");

  // Surface a clear error rather than silently no-op when the user hits
  // unpublish on a never-published layout — the menu should already be
  // disabled in that case, but a stale UI shouldn't write garbage.
  if (layoutRow.livePublishedCheckpointId == null) {
    throw new ORPCError("BAD_REQUEST", { message: "Layout is not published." });
  }

  const now = Date.now();
  const updated = await ctx.db
    .update(layouts)
    .set({ livePublishedCheckpointId: null, updatedAt: now })
    .where(eq(layouts.id, id))
    .returning()
    .get();

  await invalidateLayoutPublish(ctx, {
    projectId: access.projectId,
    environmentId: layoutRow.environmentId,
    layoutId: id,
  });

  return updated;
}
