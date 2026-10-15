import { queryKeys } from "@camox/api-contract/query-keys";
import { and, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { Effect } from "effect";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import { assertSyncAccess } from "../../authorization";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { decodeInput, NotFoundError } from "../../lib/errors";
import { resolveEnvironment } from "../../lib/resolve-environment";
import {
  blockDefinitions,
  blocks,
  comments,
  layouts,
  projects,
  repeatableItems,
} from "../../schema";
import { injectRepeatableItemMarkers } from "../_shared/block-markers";
import { readOwnerBlocks } from "../_shared/owner-blocks";
import type { ServiceContext } from "../_shared/service-context";
import { prepareBlockContent } from "../blocks/prepare-content";
import { adoptSharedContent } from "../blocks/shared-content";
import {
  hydrateItemReferences,
  hydrateReferences,
  validateReferenceValues,
} from "../collections/references";
import { releasedNew, visibleIn } from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import { buildFileMap, collectFileIds } from "../pages/ai";
import { blocksOfLayout, layoutNamed } from "./identity";

// --- Input Schemas ---
// Exported so adapters (oRPC, MCP, CLI) share the same canonical contract.
// Services .parse() them on entry — service is the trust boundary.

export const getLayoutInput = z.object({ projectSlug: z.string(), layoutId: z.string() });

export const listLayoutsInput = z.object({ projectId: z.number() });
const repeatableItemSeedSchema = z.object({
  tempId: z.string(),
  parentTempId: z.string().nullable(),
  fieldName: z.string(),
  content: z.unknown(),
  settings: z.unknown().optional(),
  position: z.string(),
});

export const syncLayoutsInput = z.object({
  projectSlug: z.string(),
  deployToken: z.string().optional(),
  autoCreate: z.boolean(),
  layouts: z.array(
    z.object({
      layoutId: z.string(),
      kind: z.enum(["curated", "derived", "singleton"]).default("curated"),
      description: z.string(),
      blocks: z.array(
        z.preprocess(
          // SDKs before 0.45 send the layout slot as `placement`.
          (block) =>
            block && typeof block === "object" && "placement" in block && !("slot" in block)
              ? { ...block, slot: block.placement }
              : block,
          z.object({
            type: z.string(),
            content: z.unknown(),
            settings: z.unknown().optional(),
            slot: z.enum(["before", "after"]).optional(),
            repeatableItems: z.array(repeatableItemSeedSchema).optional(),
          }),
        ),
      ),
    }),
  ),
});

// --- Reads ---

export const listLayouts = Effect.fn("layouts.listLayouts")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listLayoutsInput>,
) {
  const { projectId } = yield* decodeInput(listLayoutsInput, rawInput);
  const environment = yield* resolveEnvironment(ctx.db, projectId, ctx.environmentName);
  return yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(layouts)
      .where(and(eq(layouts.projectId, projectId), eq(layouts.environmentId, environment.id))),
  );
});

// Standalone layout reads use the same current blocks as curated pages.
export const getLayout = Effect.fn("layouts.getLayout")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getLayoutInput>,
  scope: DraftScope,
) {
  const { projectSlug, layoutId } = yield* decodeInput(getLayoutInput, rawInput);
  const project = yield* Effect.promise(() =>
    ctx.db.select().from(projects).where(eq(projects.slug, projectSlug)).get(),
  );
  if (!project) return yield* new NotFoundError();
  const environment = yield* resolveEnvironment(ctx.db, project.id, ctx.environmentName);
  const layout = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(layouts)
      .where(and(eq(layouts.environmentId, environment.id), eq(layouts.layoutId, layoutId)))
      .get(),
  );
  if (!layout) return yield* new NotFoundError();

  const { blocks: layoutBlocks, items } = yield* readOwnerBlocks(ctx, layout, scope);
  const normalized = layoutBlocks.map((block) =>
    injectRepeatableItemMarkers(
      block,
      items.filter((item) => item.blockId === block.id),
    ),
  );
  const hydrated = yield* hydrateReferences(
    ctx,
    layout,
    normalized.map(({ block }) => block),
  );
  const hydratedItems = yield* hydrateItemReferences(
    ctx,
    layout,
    layoutBlocks,
    normalized.flatMap(({ items }) => items),
  );
  const fileIds = new Set<string>();
  for (const value of [...layoutBlocks, ...items])
    collectFileIds(value.content as Record<string, unknown>, fileIds);
  for (const value of [...hydrated, ...hydratedItems]) collectFileIds(value.references, fileIds);
  const fileRows = yield* buildFileMap(ctx.db, fileIds, scope);
  return {
    projectName: project.name,
    // Enough for the SDK to build a cache-busted favicon URL, as for pages.
    project: { id: project.id, updatedAt: project.updatedAt },
    layout: {
      layoutId: layout.layoutId,
      contentUpdatedAt: layout.contentUpdatedAt,
      updatedAt: layout.updatedAt,
      beforeBlockIds: layoutBlocks
        .filter((block) => block.slot === "before")
        .map((block) => block.id),
      afterBlockIds: layoutBlocks
        .filter((block) => block.slot === "after")
        .map((block) => block.id),
    },
    blocks: hydrated,
    repeatableItems: hydratedItems,
    files: [...fileRows.values()],
  };
});

// --- Writes ---

type LayoutRow = typeof layouts.$inferSelect;

/** Syncing an unchanged layout writes nothing to it. */
const updateSyncedLayout = Effect.fn("layouts.updateSyncedLayout")(function* (
  ctx: ServiceContext,
  existing: LayoutRow,
  def: { description: string; kind: LayoutRow["kind"] },
  now: number,
) {
  if (existing.description === def.description && existing.kind === def.kind) return existing;
  return yield* Effect.promise(() =>
    ctx.db
      .update(layouts)
      .set({ description: def.description, kind: def.kind, updatedAt: now })
      .where(layoutNamed(existing.environmentId, existing.layoutId))
      .returning()
      .get(),
  );
});

export const syncLayouts = Effect.fn("layouts.syncLayouts")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof syncLayoutsInput>,
) {
  const input = yield* decodeInput(syncLayoutsInput, rawInput);
  const { projectSlug, layouts: layoutDefs, autoCreate } = input;
  const project = yield* assertSyncAccess(ctx.db, projectSlug, {
    user: ctx.user,
    environmentName: ctx.environmentName,
    deployToken: input.deployToken,
  });
  const projectId = project.id;
  const environment = yield* resolveEnvironment(ctx.db, projectId, ctx.environmentName, {
    autoCreate,
  });
  const existingLayouts = yield* Effect.promise(() =>
    ctx.db.select().from(layouts).where(eq(layouts.environmentId, environment.id)),
  );
  const now = Date.now();
  const results = [];

  const definitions = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, projectId),
          eq(blockDefinitions.environmentId, environment.id),
        ),
      ),
  );
  const definitionsByType = new Map(
    definitions.map((definition) => [definition.blockId, definition]),
  );
  const layoutOnlyTypes = new Set(definitions.filter((d) => d.layoutOnly).map((d) => d.blockId));

  // Preflight the whole submission before updating layouts or removing blocks.
  // Persist the normalized values returned by validation, including defaults.
  const preparedLayouts = yield* Effect.forEach(layoutDefs, (def) =>
    Effect.map(
      Effect.forEach(def.blocks, (block) => {
        const definition = definitionsByType.get(block.type);
        return Effect.map(
          prepareBlockContent(
            block.content,
            block.settings,
            block.repeatableItems,
            definition?.contentSchema,
            definition?.settingsSchema,
          ),
          (prepared) => ({ ...block, ...prepared, repeatableItems: prepared.seeds }),
        );
      }),
      (blocks) => ({ ...def, blocks }),
    ),
  );

  // Only declared blocks Live lacks are written, so only they are checked: content already on
  // Live, like a link to a page deleted since, never fails a release.
  const declaredOnLive = new Set<string>();
  for (const layout of existingLayouts) {
    const placed = yield* Effect.promise(() =>
      ctx.db
        .select({ type: blocks.type, slot: blocks.slot })
        .from(blocks)
        .where(and(visibleIn(blocks, null), blocksOfLayout(layout))),
    );
    for (const block of placed) {
      declaredOnLive.add(`${layout.layoutId}:${block.type}:${block.slot ?? ""}`);
    }
  }

  for (const def of preparedLayouts) {
    for (const block of def.blocks) {
      if (declaredOnLive.has(`${def.layoutId}:${block.type}:${block.slot ?? ""}`)) continue;
      yield* validateReferenceValues(
        ctx,
        { projectId, environmentId: environment.id },
        definitionsByType.get(block.type)?.contentSchema,
        block.bundle,
      );
    }
  }

  for (const def of preparedLayouts) {
    const existingLayout = existingLayouts.find((layout) => layout.layoutId === def.layoutId);
    const layout = existingLayout
      ? yield* updateSyncedLayout(ctx, existingLayout, def, now)
      : yield* Effect.promise(() =>
          ctx.db
            .insert(layouts)
            .values({
              projectId,
              environmentId: environment.id,
              layoutId: def.layoutId,
              kind: def.kind,
              description: def.description,
              contentUpdatedAt: now,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get(),
        );

    const createdBlockTypes: string[] = [];

    // Before/after blocks can only be declared in code — the UI can't create
    // them — so every sync must backfill any declared layout block missing from
    // the DB. Never overwrite an existing block: users may have edited its
    // content in the UI.
    const existingBlocks = yield* Effect.promise(() =>
      ctx.db
        .select({
          id: blocks.id,
          type: blocks.type,
          slot: blocks.slot,
          position: blocks.position,
        })
        .from(blocks)
        .where(and(visibleIn(blocks, null), blocksOfLayout(layout))),
    );

    const existingByKey = new Map<string, string>();
    for (const b of existingBlocks) {
      existingByKey.set(`${b.type}:${b.slot ?? ""}`, b.position);
    }

    const declared = def.blocks.map((blockDef) => ({
      def: blockDef,
      position: existingByKey.get(`${blockDef.type}:${blockDef.slot ?? ""}`) ?? null,
    }));

    let lastPos: string | null = null;
    for (let i = 0; i < declared.length; i++) {
      const entry = declared[i];
      if (entry.position !== null) {
        lastPos = entry.position;
        continue;
      }

      let nextPos: string | null = null;
      for (let j = i + 1; j < declared.length; j++) {
        if (declared[j].position !== null) {
          nextPos = declared[j].position;
          break;
        }
      }

      const newPos = generateKeyBetween(lastPos, nextPos);
      const blockDef = entry.def;
      createdBlockTypes.push(blockDef.type);

      const block = yield* Effect.promise(() =>
        ctx.db
          .insert(blocks)
          .values({
            environmentId: layout.environmentId,
            layoutId: layout.layoutId,
            type: blockDef.type,
            content: blockDef.content,
            settings: blockDef.settings ?? null,
            slot: blockDef.slot ?? null,
            position: newPos,
            summary: "",
            ...releasedNew(now),
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get(),
      );

      const itemSeeds = blockDef.repeatableItems;
      if (itemSeeds && itemSeeds.length > 0) {
        const tempIdToRealId = new Map<string, string>();
        for (const seed of itemSeeds) {
          const parentItemId = seed.parentTempId
            ? (tempIdToRealId.get(seed.parentTempId) ?? null)
            : null;
          const inserted = yield* Effect.promise(() =>
            ctx.db
              .insert(repeatableItems)
              .values({
                blockId: block.id,
                parentItemId,
                fieldName: seed.fieldName,
                content: seed.content,
                settings: seed.settings ?? null,
                summary: "",
                position: seed.position,
                createdAt: now,
                updatedAt: now,
              })
              .returning()
              .get(),
          );
          tempIdToRealId.set(seed.tempId, inserted.id);
        }
      }

      yield* adoptSharedContent(ctx, block);
      entry.position = newPos;
      lastPos = newPos;
    }

    const declaredKeys = new Set(def.blocks.map((bd) => `${bd.type}:${bd.slot ?? ""}`));
    const removedBlockTypes: string[] = [];
    const skippedOrphanTypes: string[] = [];
    const orphanIdsToDelete: string[] = [];
    for (const existing of existingBlocks) {
      const key = `${existing.type}:${existing.slot ?? ""}`;
      if (declaredKeys.has(key)) continue;
      if (layoutOnlyTypes.has(existing.type)) {
        orphanIdsToDelete.push(existing.id);
        removedBlockTypes.push(existing.type);
      } else {
        skippedOrphanTypes.push(existing.type);
      }
    }
    if (orphanIdsToDelete.length > 0) {
      // A release writes Live, deleting Live's comments on what it deletes; drafts keep theirs.
      // Items and comments hold no foreign key to their block (ADR 0005).
      yield* Effect.promise(() =>
        ctx.db.batch([
          ctx.db
            .delete(comments)
            .where(and(isNull(comments.draftId), inArray(comments.blockId, orphanIdsToDelete))),
          ctx.db.delete(repeatableItems).where(inArray(repeatableItems.blockId, orphanIdsToDelete)),
          ctx.db
            .delete(blocks)
            .where(and(visibleIn(blocks, null), inArray(blocks.id, orphanIdsToDelete))),
        ]),
      );
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
  const orphanLayoutQuery = ctx.db.select({ layoutId: layouts.layoutId }).from(layouts);
  const orphanLayouts = yield* Effect.promise(() =>
    submittedLayoutIds.length > 0
      ? orphanLayoutQuery.where(
          and(
            eq(layouts.projectId, projectId),
            eq(layouts.environmentId, environment.id),
            notInArray(layouts.layoutId, submittedLayoutIds),
          ),
        )
      : orphanLayoutQuery.where(
          and(eq(layouts.projectId, projectId), eq(layouts.environmentId, environment.id)),
        ),
  );

  // A removed layout's pages and blocks stay stored under its name and come back with it.
  // Meanwhile its pages aren't served, and the studio lists them as needing a layout.
  const removedLayoutIds = orphanLayouts.map((orphan) => orphan.layoutId);
  for (const layoutId of removedLayoutIds) {
    yield* Effect.promise(() =>
      ctx.db.delete(layouts).where(layoutNamed(environment.id, layoutId)),
    );
  }

  // A layoutOnly block definition only makes sense while at least one
  // layout-scoped `blocks` row references it. Once the last reference is
  // pruned (either via orphan cleanup above or layout deletion), drop the
  // definition too so the DB doesn't accumulate UI-invisible rows.
  const usedTypes = yield* Effect.promise(() =>
    ctx.db
      .selectDistinct({ type: blocks.type })
      .from(blocks)
      .where(and(eq(blocks.environmentId, environment.id), isNotNull(blocks.layoutId))),
  );
  const usedTypeSet = new Set(usedTypes.map((r) => r.type));

  const deletedDefinitionTypes: string[] = [];
  for (const layoutOnlyType of layoutOnlyTypes) {
    if (!usedTypeSet.has(layoutOnlyType)) {
      deletedDefinitionTypes.push(layoutOnlyType);
    }
  }
  if (deletedDefinitionTypes.length > 0) {
    yield* Effect.promise(() =>
      ctx.db
        .delete(blockDefinitions)
        .where(
          and(
            eq(blockDefinitions.projectId, projectId),
            eq(blockDefinitions.environmentId, environment.id),
            inArray(blockDefinitions.blockId, deletedDefinitionTypes),
          ),
        ),
    );
  }

  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: null,
    projectId,
    targets: [queryKeys.layouts.all, queryKeys.pages.getByPathAll],
  });

  return {
    layouts: results,
    removedLayoutIds,
    deletedDefinitionTypes,
  };
});
