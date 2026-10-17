import { queryKeys } from "@camox/api-contract/query-keys";
import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { Effect } from "effect";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import { assertSyncAccess } from "../../authorization";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { decodeInput, NotFoundError } from "../../lib/errors";
import { blockDefinitions, blocks, layouts, repeatableItems } from "../../schema";
import { injectRepeatableItemMarkers } from "../_shared/block-markers";
import { definitionsDraftOf, definitionsIn } from "../_shared/definitions";
import { readOwnerBlocks } from "../_shared/owner-blocks";
import { layoutSchemaHash } from "../_shared/schema-hash";
import type { ServiceContext } from "../_shared/service-context";
import { prepareBlockContent } from "../blocks/prepare-content";
import { adoptSharedContent } from "../blocks/shared-content";
import {
  hydrateItemReferences,
  hydrateReferences,
  validateReferenceValues,
} from "../collections/references";
import { accessTo } from "../drafts/access";
import * as overlay from "../drafts/overlay";
import { visibleIn } from "../drafts/overlay";
import { RELEASE, type WriteTarget } from "../drafts/scope";
import { buildFileMap, collectFileIds } from "../pages/ai";
import { blocksOfLayout } from "./identity";
import type { RecordPages } from "./schema";

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
      /** A derived layout's record pages: the collection they render, found by `field`. */
      recordPages: z.object({ collectionId: z.string(), field: z.string() }).optional(),
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
  const { scope } = yield* accessTo(ctx, { project: projectId }, "public");
  return yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(layouts)
      .where(and(eq(layouts.projectId, projectId), definitionsIn(layouts, scope))),
  );
}, Effect.scoped);

// Standalone layout reads use the same current blocks as curated pages.
export const getLayout = Effect.fn("layouts.getLayout")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getLayoutInput>,
) {
  const { projectSlug, layoutId } = yield* decodeInput(getLayoutInput, rawInput);
  const { scope, project } = yield* accessTo(ctx, { projectSlug }, "public");
  const layout = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(layouts)
      .where(
        and(
          eq(layouts.projectId, project.id),
          eq(layouts.layoutId, layoutId),
          definitionsIn(layouts, scope),
        ),
      )
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
    { ...layout, draft: scope },
    normalized.map(({ block }) => block),
  );
  const hydratedItems = yield* hydrateItemReferences(
    ctx,
    { ...layout, draft: scope },
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
}, Effect.scoped);

// --- Writes ---

type LayoutRow = typeof layouts.$inferSelect;

/** Syncing an unchanged layout writes nothing to it. */
const updateSyncedLayout = Effect.fn("layouts.updateSyncedLayout")(function* (
  ctx: ServiceContext,
  existing: LayoutRow,
  def: { description: string; kind: LayoutRow["kind"]; recordPages?: RecordPages },
  now: number,
) {
  const recordPages = def.recordPages ?? null;
  if (
    existing.description === def.description &&
    existing.kind === def.kind &&
    JSON.stringify(existing.recordPages) === JSON.stringify(recordPages)
  ) {
    return existing;
  }
  const schemaHash = yield* Effect.promise(() => layoutSchemaHash(def));
  return yield* Effect.promise(() =>
    ctx.db
      .update(layouts)
      .set({
        description: def.description,
        kind: def.kind,
        recordPages,
        schemaHash,
        updatedAt: now,
      })
      .where(eq(layouts.rowId, existing.rowId))
      .returning()
      .get(),
  );
});

type DeclaredBlock = Pick<
  typeof blocks.$inferInsert,
  "projectId" | "layoutId" | "type" | "content" | "settings" | "slot" | "position"
>;
type ItemSeed = {
  tempId: string;
  parentTempId: string | null;
  fieldName: string;
  content: unknown;
  settings?: unknown;
  position: string;
};

/**
 * Seeds a block a layout declares, with its repeatable items, in the sync's target: on Live as
 * released content, in a development draft as draft rows (ADR 0006).
 */
const insertDeclaredBlock = Effect.fn("layouts.insertDeclaredBlock")(function* (
  ctx: ServiceContext,
  target: WriteTarget,
  values: DeclaredBlock,
  seeds: readonly ItemSeed[] | undefined,
  now: number,
) {
  const timestamps = { createdAt: now, updatedAt: now };
  // A fresh id, so the target can't already hold the block or its items.
  const block = (yield* overlay.insert(ctx.db, target, blocks, { ...values, ...timestamps }))!;

  const tempIdToRealId = new Map<string, string>();
  for (const seed of seeds ?? []) {
    const item = {
      blockId: block.id,
      parentItemId: seed.parentTempId ? (tempIdToRealId.get(seed.parentTempId) ?? null) : null,
      fieldName: seed.fieldName,
      content: seed.content,
      settings: seed.settings ?? null,
      position: seed.position,
      ...timestamps,
    };
    const inserted = (yield* overlay.insert(ctx.db, target, repeatableItems, item))!;
    tempIdToRealId.set(seed.tempId, inserted.id);
  }
  return block;
});

/**
 * Deletes layout-only blocks no layout declares any more, in the sync's target. A release
 * deletes Live's with their items; drafts keep theirs. Dev mode
 * deletes them in the development draft.
 */
const deleteOrphanedBlocks = Effect.fn("layouts.deleteOrphanedBlocks")(function* (
  ctx: ServiceContext,
  target: WriteTarget,
  ids: string[],
) {
  if (ids.length === 0) return;
  if (target === RELEASE) {
    // Items hold no foreign key to their block (ADR 0005).
    const items = yield* overlay.select(
      ctx.db,
      null,
      repeatableItems,
      inArray(repeatableItems.blockId, ids),
    );
    for (const item of items) yield* overlay.remove(ctx.db, target, repeatableItems, item.id);
  }
  for (const id of ids) yield* overlay.remove(ctx.db, target, blocks, id);
});

export const syncLayouts = Effect.fn("layouts.syncLayouts")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof syncLayoutsInput>,
) {
  const input = yield* decodeInput(syncLayoutsInput, rawInput);
  const { projectSlug, layouts: layoutDefs, autoCreate } = input;
  // A release writes Live; dev mode writes the caller's development draft (ADR 0006).
  const {
    project,
    scope,
    writes: target,
  } = yield* assertSyncAccess(
    ctx.db,
    projectSlug,
    { user: ctx.user, draft: ctx.draft, deployToken: input.deployToken },
    { create: autoCreate },
  );
  const projectId = project.id;
  const inTarget = and(eq(layouts.projectId, projectId), definitionsIn(layouts, scope));
  const existingLayouts = yield* Effect.promise(() =>
    ctx.db.select().from(layouts).where(inTarget),
  );
  const now = Date.now();
  const results = [];

  const definitions = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(
        and(eq(blockDefinitions.projectId, projectId), definitionsIn(blockDefinitions, scope)),
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

  // Only declared blocks the target lacks are written, so only they are checked: content already
  // there, like a link to a page deleted since, never fails a sync.
  const declaredInTarget = new Set<string>();
  for (const layout of existingLayouts) {
    const placed = yield* Effect.promise(() =>
      ctx.db
        .select({ type: blocks.type, slot: blocks.slot })
        .from(blocks)
        .where(and(visibleIn(blocks, scope), blocksOfLayout(layout))),
    );
    for (const block of placed) {
      declaredInTarget.add(`${layout.layoutId}:${block.type}:${block.slot ?? ""}`);
    }
  }

  for (const def of preparedLayouts) {
    for (const block of def.blocks) {
      if (declaredInTarget.has(`${def.layoutId}:${block.type}:${block.slot ?? ""}`)) continue;
      yield* validateReferenceValues(
        ctx,
        { projectId, draft: scope },
        definitionsByType.get(block.type)?.contentSchema,
        block.bundle,
      );
    }
  }

  for (const def of preparedLayouts) {
    const existingLayout = existingLayouts.find((layout) => layout.layoutId === def.layoutId);
    const layout = existingLayout
      ? yield* updateSyncedLayout(ctx, existingLayout, def, now)
      : yield* Effect.promise(async () =>
          ctx.db
            .insert(layouts)
            .values({
              draftId: definitionsDraftOf(scope),
              schemaHash: await layoutSchemaHash(def),
              projectId,
              layoutId: def.layoutId,
              kind: def.kind,
              description: def.description,
              recordPages: def.recordPages ?? null,
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
        .where(and(visibleIn(blocks, scope), blocksOfLayout(layout))),
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

      const block = yield* insertDeclaredBlock(
        ctx,
        target,
        {
          projectId: layout.projectId,
          layoutId: layout.layoutId,
          type: blockDef.type,
          content: blockDef.content,
          settings: blockDef.settings ?? null,
          slot: blockDef.slot ?? null,
          position: newPos,
        },
        blockDef.repeatableItems,
        now,
      );

      yield* adoptSharedContent(ctx, target, block);
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
    yield* deleteOrphanedBlocks(ctx, target, orphanIdsToDelete);

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
            inTarget,
            notInArray(layouts.layoutId, submittedLayoutIds),
          ),
        )
      : orphanLayoutQuery.where(and(eq(layouts.projectId, projectId), inTarget)),
  );

  // A removed layout's pages and blocks stay stored under its name and come back with it.
  // Meanwhile its pages aren't served, and the studio lists them as needing a layout.
  const removedLayoutIds = orphanLayouts.map((orphan) => orphan.layoutId);
  for (const layoutId of removedLayoutIds) {
    yield* Effect.promise(() =>
      ctx.db.delete(layouts).where(and(inTarget, eq(layouts.layoutId, layoutId))),
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
      .where(
        and(eq(blocks.projectId, projectId), isNotNull(blocks.layoutId), visibleIn(blocks, scope)),
      ),
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
            definitionsIn(blockDefinitions, scope),
            inArray(blockDefinitions.blockId, deletedDefinitionTypes),
          ),
        ),
    );
  }

  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: scope?.id ?? null,
    projectId,
    targets: [queryKeys.layouts.all, queryKeys.pages.getByPathAll],
  });

  return {
    layouts: results,
    removedLayoutIds,
    deletedDefinitionTypes,
  };
});
