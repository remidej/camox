import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { Effect } from "effect";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import type { SyncTarget } from "../../authorization";
import { decodeInput, NotFoundError } from "../../lib/errors";
import { blockDefinitions, blocks, layouts, repeatableItems } from "../../schema";
import { definitionsDraftOf, definitionsIn } from "../_shared/definitions";
import { layoutSchemaHash } from "../_shared/schema-hash";
import type { ServiceContext } from "../_shared/service-context";
import type { SyncedDefinitions } from "../block-definitions/service";
import { prepareBlockContent } from "../blocks/prepare-content";
import { planDeclaredPlacement } from "../blocks/shared-content";
import { validateReferenceValues } from "../collections/references";
import { contentReader } from "../content/reader";
import { accessTo } from "../drafts/access";
import * as overlay from "../drafts/overlay";
import { visibleIn } from "../drafts/overlay";
import { RELEASE, type WriteTarget } from "../drafts/scope";
import { publicProjectSummary } from "../projects/public-summary";
import { namingProject, projectRefOf } from "../projects/ref";
import { LAYOUT_KINDS, type RecordPages } from "./schema";

// --- Input Schemas ---
// Exported so adapters (oRPC, MCP, CLI) share the same canonical contract.
// Services .parse() them on entry — service is the trust boundary.

export const getLayoutInput = namingProject(z.object({ layoutId: z.string() }));

export const listLayoutsInput = z.object({ projectId: z.number() });

/** A repeatable item a definition declares under a block, by temporary ids. */
export const repeatableItemSeedSchema = z.object({
  tempId: z.string(),
  parentTempId: z.string().nullable(),
  fieldName: z.string(),
  content: z.unknown(),
  settings: z.unknown().optional(),
  position: z.string(),
});

/** A layout definition as a Definition Set holds it, with the blocks it declares. */
export const layoutDefinitionInput = z.object({
  layoutId: z.string(),
  kind: z.enum(LAYOUT_KINDS).default("curated"),
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
  const { layoutId, ...named } = yield* decodeInput(getLayoutInput, rawInput);
  const { scope, project } = yield* accessTo(ctx, projectRefOf(named), "public");
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

  const reader = contentReader(ctx, { projectId: project.id, draft: scope });
  const content = yield* reader.blocks([{ layoutId: layout.layoutId }]);
  const structuredData = yield* reader.structuredData(content);
  const layoutBlocks = content.blocks;
  return {
    projectName: project.name,
    project: publicProjectSummary(project),
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
    blocks: content.blocks,
    repeatableItems: content.repeatableItems,
    files: content.files,
    /** Each block's Structured Data nodes, by block id, for the graph of the layout's pages. */
    structuredData,
  };
}, Effect.scoped);

// --- Definition sync ---

/** The layouts a sync's target holds before its batch runs: their ids and kinds. */
export const targetLayouts = Effect.fn("layouts.targetLayouts")(function* (
  ctx: ServiceContext,
  { project, scope }: Pick<SyncTarget, "project" | "scope">,
) {
  return yield* Effect.promise(() =>
    ctx.db
      .select({ layoutId: layouts.layoutId, kind: layouts.kind })
      .from(layouts)
      .where(and(eq(layouts.projectId, project.id), definitionsIn(layouts, scope))),
  );
});

type LayoutRow = typeof layouts.$inferSelect;
type LayoutDefinition = z.infer<typeof layoutDefinitionInput>;

/** Plans updating a synced layout. Syncing an unchanged layout writes nothing to it. */
const planLayoutUpdate = Effect.fn("layouts.planLayoutUpdate")(function* (
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
    return overlay.nothingPlanned(undefined);
  }
  const schemaHash = yield* Effect.promise(() => layoutSchemaHash(def));
  return overlay.plannedStatements(
    ctx.db
      .update(layouts)
      .set({
        description: def.description,
        kind: def.kind,
        recordPages,
        schemaHash,
        updatedAt: now,
      })
      .where(eq(layouts.rowId, existing.rowId)),
  );
});

/**
 * Plans deleting layout-only blocks no layout declares any more, in the sync's target. A release
 * deletes Live's with their items; drafts keep theirs. Dev mode deletes them in the development
 * draft.
 */
const planOrphanedBlocksRemoval = Effect.fn("layouts.planOrphanedBlocksRemoval")(function* (
  ctx: ServiceContext,
  target: WriteTarget,
  ids: string[],
) {
  const plan = overlay.planner();
  if (ids.length === 0) return plan.done(undefined);
  if (target === RELEASE) {
    // Items hold no foreign key to their block (ADR 0005).
    const items = yield* overlay.select(
      ctx.db,
      null,
      repeatableItems,
      inArray(repeatableItems.blockId, ids),
    );
    for (const item of items) {
      plan.add(yield* overlay.planRemove(ctx.db, target, repeatableItems, item.id));
    }
  }
  for (const id of ids) plan.add(yield* overlay.planRemove(ctx.db, target, blocks, id));
  return plan.done(undefined);
});

/**
 * Plans replacing the layouts of a sync's target: Live for a release, or the development draft
 * for dev mode (ADR 0006). Each layout gets the blocks it declares that it lacks, between the
 * ones it holds; layout-only blocks it no longer declares go, and so do layouts and layout-only
 * definitions nothing uses any more. Block and collection definitions come from the sync
 * (`definitions`, `collections`), not the target, which only holds them once the batch ran.
 * `definitions` learns which ones the declared blocks give shared content.
 */
export const planLayouts = Effect.fn("layouts.plan")(function* (
  ctx: ServiceContext,
  { project, scope, writes: target }: SyncTarget,
  layoutDefs: readonly LayoutDefinition[],
  {
    definitions,
    collections,
  }: { definitions: SyncedDefinitions; collections: ReadonlySet<string> },
  now: number,
) {
  const projectId = project.id;
  const plan = overlay.planner();
  const inTarget = and(eq(layouts.projectId, projectId), definitionsIn(layouts, scope));
  const existingLayouts = yield* Effect.promise(() =>
    ctx.db.select().from(layouts).where(inTarget),
  );
  // Every layout's blocks, including those of layouts gone from code, which come back with them.
  const layoutBlocks = yield* Effect.promise(() =>
    ctx.db
      .select({
        id: blocks.id,
        layoutId: blocks.layoutId,
        type: blocks.type,
        slot: blocks.slot,
        position: blocks.position,
      })
      .from(blocks)
      .where(
        and(eq(blocks.projectId, projectId), isNotNull(blocks.layoutId), visibleIn(blocks, scope)),
      ),
  );
  const blocksOf = (layoutId: string) => layoutBlocks.filter((b) => b.layoutId === layoutId);
  const layoutOnlyTypes = new Set(
    [...definitions].filter(([, definition]) => definition.layoutOnly).map(([type]) => type),
  );

  // Preflight the whole submission before planning any write.
  // Persist the normalized values returned by validation, including defaults.
  const preparedLayouts = yield* Effect.forEach(layoutDefs, (def) =>
    Effect.map(
      Effect.forEach(def.blocks, (block) => {
        const definition = definitions.get(block.type);
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
    for (const block of blocksOf(layout.layoutId)) {
      declaredInTarget.add(`${layout.layoutId}:${block.type}:${block.slot ?? ""}`);
    }
  }
  for (const def of preparedLayouts) {
    for (const block of def.blocks) {
      if (declaredInTarget.has(`${def.layoutId}:${block.type}:${block.slot ?? ""}`)) continue;
      yield* validateReferenceValues(
        ctx,
        { projectId, draft: scope, collections },
        definitions.get(block.type)?.contentSchema,
        block.bundle,
      );
    }
  }

  const results = [];
  const deletedBlockIds = new Set<string>();
  const createdTypes = new Set<string>();
  for (const def of preparedLayouts) {
    const existingLayout = existingLayouts.find((layout) => layout.layoutId === def.layoutId);
    if (existingLayout) {
      plan.add(yield* planLayoutUpdate(ctx, existingLayout, def, now));
    } else {
      const schemaHash = yield* Effect.promise(() => layoutSchemaHash(def));
      plan.add(
        overlay.plannedStatements(
          ctx.db.insert(layouts).values({
            draftId: definitionsDraftOf(scope),
            schemaHash,
            projectId,
            layoutId: def.layoutId,
            kind: def.kind,
            description: def.description,
            recordPages: def.recordPages ?? null,
            contentUpdatedAt: now,
            createdAt: now,
            updatedAt: now,
          }),
        ),
      );
    }

    const createdBlockTypes: string[] = [];

    // Before/after blocks can only be declared in code — the UI can't create
    // them — so every sync must backfill any declared layout block missing from
    // the DB. Never overwrite an existing block: users may have edited its
    // content in the UI.
    const existingBlocks = blocksOf(def.layoutId);
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
      createdTypes.add(blockDef.type);

      const definition = definitions.get(blockDef.type);
      const placed = plan.add(
        yield* planDeclaredPlacement(
          ctx.db,
          target,
          {
            projectId,
            layoutId: def.layoutId,
            type: blockDef.type,
            content: blockDef.content,
            settings: blockDef.settings ?? null,
            slot: blockDef.slot ?? null,
            position: newPos,
          },
          blockDef.repeatableItems,
          {
            synced: definition?.synced ?? false,
            hasSharedContent: definition?.hasSharedContent ?? false,
          },
        ),
      );
      if (definition && placed.adoption === "seeded") definition.hasSharedContent = true;
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
        deletedBlockIds.add(existing.id);
        removedBlockTypes.push(existing.type);
      } else {
        skippedOrphanTypes.push(existing.type);
      }
    }
    plan.add(yield* planOrphanedBlocksRemoval(ctx, target, orphanIdsToDelete));

    results.push({
      layoutId: def.layoutId,
      wasExisting: Boolean(existingLayout),
      createdBlockTypes,
      removedBlockTypes,
      skippedOrphanTypes,
    });
  }

  // A removed layout's pages and blocks stay stored under its name and come back with it.
  // Meanwhile its pages aren't served, and the studio lists them as needing a layout.
  const submittedLayoutIds = new Set(layoutDefs.map((d) => d.layoutId));
  const removedLayouts = existingLayouts.filter(
    (layout) => !submittedLayoutIds.has(layout.layoutId),
  );
  for (const layout of removedLayouts) {
    plan.add(
      overlay.plannedStatements(ctx.db.delete(layouts).where(eq(layouts.rowId, layout.rowId))),
    );
  }

  // A layoutOnly block definition only makes sense while at least one
  // layout-scoped `blocks` row references it. Once the last reference is
  // pruned (either via orphan cleanup above or layout deletion), drop the
  // definition too so the DB doesn't accumulate UI-invisible rows.
  const usedTypes = new Set(createdTypes);
  for (const block of layoutBlocks) {
    if (!deletedBlockIds.has(block.id)) usedTypes.add(block.type);
  }
  const deletedDefinitionTypes = [...layoutOnlyTypes].filter((type) => !usedTypes.has(type));
  if (deletedDefinitionTypes.length > 0) {
    plan.add(
      overlay.plannedStatements(
        ctx.db
          .delete(blockDefinitions)
          .where(
            and(
              eq(blockDefinitions.projectId, projectId),
              definitionsIn(blockDefinitions, scope),
              inArray(blockDefinitions.blockId, deletedDefinitionTypes),
            ),
          ),
      ),
    );
    for (const type of deletedDefinitionTypes) definitions.delete(type);
  }

  return plan.done({
    layouts: results,
    removedLayoutIds: removedLayouts.map((layout) => layout.layoutId),
    deletedDefinitionTypes,
  });
});
