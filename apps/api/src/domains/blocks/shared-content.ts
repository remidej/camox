import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { blocks, repeatableItems, sharedContentId, sharedContents } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import * as overlay from "../drafts/overlay";
import { readScopeOf, type ReadScope, type WriteTarget } from "../drafts/scope";
import type { GeneratedEntity } from "../generated-values/schema";
import { readValuesOf } from "../generated-values/service";
import {
  itemsUnder,
  rootColumns,
  rootOfItem,
  type DefinitionKey,
  type ItemRoot,
} from "../repeatable-items/roots";
import { findDefinition } from "./content-schema";
import { prepareBlockContent } from "./prepare-content";

/**
 * A synced block definition's shared content (ADR 0004, 0005) is one entity per definition name
 * in a project. Every placement of the definition shows it, and placements hold only their
 * identity, position and slot. A definition is synced exactly while its shared content exists:
 * definition syncs create and delete it (ADR 0007).
 *
 * Shared content and its repeatable items live in Live and in drafts like any content: a draft
 * reads its own copy over Live's, and every placement in the draft shows that copy. A release's
 * definition sync writes Live; dev mode's writes the development draft, as draft rows.
 */

type BlockRow = typeof blocks.$inferSelect;
type ItemRow = typeof repeatableItems.$inferSelect;
export type SharedContentRow = typeof sharedContents.$inferSelect;

/** The placements of a definition, as a scope reads them. */
function placementsWhere(key: DefinitionKey) {
  return and(eq(blocks.projectId, key.projectId), eq(blocks.type, key.type))!;
}

/** The definition a block places. */
export function definitionOf(block: { projectId: number; type: string }): DefinitionKey {
  return { projectId: block.projectId, type: block.type };
}

/** A definition's shared content as a scope reads it. */
export const findSharedContent = (db: Database, scope: ReadScope, key: DefinitionKey) =>
  overlay.get(db, scope, sharedContents, sharedContentId(key));

/** Plans creating a definition's shared content in a target. */
const planSharedContentInsert = (
  db: Database,
  target: WriteTarget,
  key: DefinitionKey,
  data: { content: unknown; settings: unknown },
) => {
  const now = Date.now();
  const row = { id: sharedContentId(key), ...key, ...data, createdAt: now, updatedAt: now };
  return overlay.planInsert(db, target, sharedContents, row);
};

/**
 * Where a block's content, settings and items live, as a scope reads them: its synced
 * definition's shared content, or the block itself.
 */
export const contentOwnerOf = Effect.fn("contentOwnerOf")(function* (
  db: Database,
  scope: ReadScope,
  block: { id: string; projectId: number; type: string },
) {
  const key = definitionOf(block);
  const shared = yield* findSharedContent(db, scope, key);
  const root: ItemRoot = shared ? { sharedContent: key } : { blockId: block.id };
  return { shared: shared ?? null, root };
});

/** The placements of a definition as a scope reads them, oldest first. */
export const placementsOf = Effect.fn("placementsOf")(function* (
  db: Database,
  scope: ReadScope,
  key: DefinitionKey,
) {
  const rows = yield* overlay.select(db, scope, blocks, placementsWhere(key));
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
});

/**
 * Blocks and items as a scope's readers see them. A placement of a synced definition shows the
 * shared content, settings and summary, and the shared items, each named under the placement's
 * `blockId`: shared items keep their ids, so several placements read the same item ids. Each
 * block and item carries its summary, a generated value the scope reads (ADR 0012).
 */
export const withSharedContent = Effect.fn("withSharedContent")(function* <B extends BlockRow>(
  db: Database,
  scope: ReadScope,
  blockRows: readonly B[],
  itemRows: readonly ItemRow[],
) {
  const shown = yield* sharedContentShown(db, scope, blockRows, itemRows);
  const summaries = yield* readValuesOf(db, scope, "summary", {
    block: shown.blocks.filter((block) => !block.sharedContentId).map((block) => block.id),
    sharedContent: shown.blocks.flatMap((block) =>
      block.sharedContentId ? [block.sharedContentId] : [],
    ),
    repeatableItem: shown.items.map((item) => item.id),
  });
  const summaryOf = (entity: GeneratedEntity, id: string) =>
    summaries.get(entity)?.get(id)?.value?.summary ?? "";
  return {
    blocks: shown.blocks.map(({ sharedContentId: shared, ...block }) => ({
      ...block,
      summary: shared ? summaryOf("sharedContent", shared) : summaryOf("block", block.id),
    })),
    items: shown.items.map((item) => ({ ...item, summary: summaryOf("repeatableItem", item.id) })),
  };
});

/** Blocks and items as a scope shows them: synced placements with their shared content and items. */
export const sharedContentShown = Effect.fn("sharedContentShown")(function* <B extends BlockRow>(
  db: Database,
  scope: ReadScope,
  blockRows: readonly B[],
  itemRows: readonly ItemRow[],
) {
  const projectIds = [...new Set(blockRows.map((block) => block.projectId))];
  const types = [...new Set(blockRows.map((block) => block.type))];
  const ownItems = (items: readonly ItemRow[]) =>
    items.filter((item): item is ItemRow & { blockId: string } => item.blockId !== null);
  const unshared = (rows: readonly B[]) =>
    rows.map((block) => ({ ...block, sharedContentId: null as string | null }));
  if (blockRows.length === 0) return { blocks: unshared(blockRows), items: ownItems(itemRows) };

  const shared = yield* overlay.select(
    db,
    scope,
    sharedContents,
    and(inArray(sharedContents.projectId, projectIds), inArray(sharedContents.type, types)),
  );
  if (shared.length === 0) return { blocks: unshared(blockRows), items: ownItems(itemRows) };
  const keyOf = ({ projectId, type }: DefinitionKey) => `${projectId}:${type}`;
  const sharedByKey = new Map(shared.map((row) => [keyOf(row), row]));
  const sharedItems = yield* overlay.select(
    db,
    scope,
    repeatableItems,
    and(
      inArray(repeatableItems.projectId, projectIds),
      inArray(
        repeatableItems.sharedContentType,
        shared.map((row) => row.type),
      ),
    ),
  );
  const itemsByKey = new Map<string, ItemRow[]>();
  for (const item of sharedItems) {
    const root = rootOfItem(item);
    if (!("sharedContent" in root)) continue;
    const itemKey = keyOf(root.sharedContent);
    if (!sharedByKey.has(itemKey)) continue;
    itemsByKey.set(itemKey, [...(itemsByKey.get(itemKey) ?? []), item]);
  }

  const placed = new Set<string>();
  const projectedBlocks = blockRows.map((block) => {
    const content = sharedByKey.get(keyOf(block));
    if (!content) return { ...block, sharedContentId: null as string | null };
    placed.add(block.id);
    return {
      ...block,
      content: content.content,
      settings: content.settings,
      sharedContentId: content.id as string | null,
    };
  });
  const items = ownItems(itemRows).filter((item) => !placed.has(item.blockId));
  for (const block of blockRows) {
    if (!placed.has(block.id)) continue;
    for (const item of itemsByKey.get(keyOf(block)) ?? []) {
      items.push({ ...item, blockId: block.id });
    }
  }
  return { blocks: projectedBlocks, items };
});

/** A placement holding nothing of its own: its content lives in the shared content. */
const clearedPlacement = { content: {}, settings: null };

type ItemValues = Pick<
  typeof repeatableItems.$inferInsert,
  "parentItemId" | "fieldName" | "content" | "settings" | "position"
>;

/** Plans creating an item with a fresh id in a write target. Returns its id. */
const planItem = Effect.fn("planItem")(function* (
  db: Database,
  target: WriteTarget,
  root: ItemRoot,
  values: ItemValues,
  now: number,
) {
  const row = { ...values, ...rootColumns(root), createdAt: now, updatedAt: now };
  const planned = yield* overlay.planInsert(db, target, repeatableItems, row);
  return { ...planned, result: planned.result!.id };
});

/**
 * Plans copying an item tree under another root in a target with fresh ids, parents before
 * children.
 */
const planItemTreeCopy = Effect.fn("planItemTreeCopy")(function* (
  db: Database,
  target: WriteTarget,
  items: readonly ItemRow[],
  root: ItemRoot,
  now: number,
) {
  const plan = overlay.planner();
  const copyChildren = (
    parentId: string | null,
    copiedParentId: string | null,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      for (const item of items.filter((candidate) => candidate.parentItemId === parentId)) {
        const copiedId = plan.add(
          yield* planItem(
            db,
            target,
            root,
            {
              parentItemId: copiedParentId,
              fieldName: item.fieldName,
              content: item.content,
              settings: item.settings,
              position: item.position,
            },
            now,
          ),
        );
        yield* copyChildren(item.id, copiedId);
      }
    });
  yield* copyChildren(null, null);
  return plan.done(undefined);
});

/** What of a block definition its defaults are built from. */
type DefinitionDefaults = {
  contentSchema: unknown;
  settingsSchema?: unknown;
  defaultContent?: unknown;
  defaultSettings?: unknown;
};

/**
 * The content a definition's defaults give a new block, with its repeatable item seeds: those of
 * `incoming`, the definition a sync writes, else of the definition the scope reads.
 */
const defaultBundle = Effect.fn("defaultBundle")(function* (
  db: Database,
  scope: ReadScope,
  key: DefinitionKey,
  incoming?: DefinitionDefaults,
) {
  const definition = incoming ?? (yield* findDefinition(db, key, scope));
  return yield* prepareBlockContent(
    definition?.defaultContent ?? undefined,
    definition?.defaultSettings ?? undefined,
    undefined,
    definition?.contentSchema,
    definition?.settingsSchema,
  ).pipe(
    Effect.orElseSucceed(() => ({
      content: {} as Record<string, unknown>,
      settings: null as unknown,
      seeds: [],
    })),
  );
});

/**
 * Plans shared content from the definition's defaults, with their repeatable items, in a
 * target.
 */
const planSharedContentFromDefaults = Effect.fn("planSharedContentFromDefaults")(function* (
  db: Database,
  target: WriteTarget,
  key: DefinitionKey,
  incoming?: DefinitionDefaults,
) {
  const now = Date.now();
  const plan = overlay.planner();
  const defaults = yield* defaultBundle(db, readScopeOf(target), key, incoming);
  plan.add(
    yield* planSharedContentInsert(db, target, key, {
      content: defaults.content,
      settings: defaults.settings ?? null,
    }),
  );
  const ids = new Map<string, string>();
  for (const seed of defaults.seeds) {
    const id = plan.add(
      yield* planItem(
        db,
        target,
        { sharedContent: key },
        {
          parentItemId: seed.parentTempId ? (ids.get(seed.parentTempId) ?? null) : null,
          fieldName: seed.fieldName,
          content: seed.content,
          settings: seed.settings ?? null,
          position: seed.position,
        },
        now,
      ),
    );
    ids.set(seed.tempId, id);
  }
  return plan.done(undefined);
});

/** The items of a placement as a scope reads them. */
const itemsOfPlacements = (db: Database, scope: ReadScope, placementIds: string[]) =>
  overlay.select(db, scope, repeatableItems, inArray(repeatableItems.blockId, placementIds));

/**
 * Plans shared content taken from a placement, as a target reads it: its content, and its items,
 * which keep their ids. On Live, moving items under the shared content is a change drafts that
 * copied them see; in a draft, the items moved are draft rows.
 */
const planSharedContentFromPlacement = Effect.fn("planSharedContentFromPlacement")(function* (
  db: Database,
  target: WriteTarget,
  placement: BlockRow,
) {
  const plan = overlay.planner();
  const key = definitionOf(placement);
  const { content, settings } = placement;
  plan.add(yield* planSharedContentInsert(db, target, key, { content, settings }));
  const moved = rootColumns({ sharedContent: key });
  for (const item of yield* itemsOfPlacements(db, readScopeOf(target), [placement.id])) {
    plan.add(yield* overlay.planUpdate(db, target, repeatableItems, item.id, moved));
  }
  return plan.done(undefined);
});

/** Plans deleting items as a target reads them: Live's rows, or a draft's tombstones. */
const planItemsRemoval = Effect.fn("planItemsRemoval")(function* (
  db: Database,
  target: WriteTarget,
  items: readonly ItemRow[],
) {
  const plan = overlay.planner();
  for (const item of items) {
    plan.add(yield* overlay.planRemove(db, target, repeatableItems, item.id));
  }
  return plan.done(undefined);
});

/**
 * Plans becoming synced (ADR 0007), in the scope whose definitions changed: Live for a release,
 * a development draft for dev mode. The shared content is taken from the most recently published
 * placement, items included, or from the definition's defaults when there is none. Every
 * placement's own content is cleared. On Live that is a change drafts that copied a placement
 * see as a conflict; in a draft it writes draft rows.
 */
const planBecomingSynced = Effect.fn("planBecomingSynced")(function* (
  db: Database,
  target: WriteTarget,
  key: DefinitionKey,
  incoming?: DefinitionDefaults,
) {
  const scope = readScopeOf(target);
  const placements = yield* placementsOf(db, scope, key);
  if (placements.length === 0) {
    return yield* planSharedContentFromDefaults(db, target, key, incoming);
  }

  const placementIds = placements.map((block) => block.id);
  const items = yield* itemsOfPlacements(db, scope, placementIds);
  const lastItemUpdate = new Map<string, number>();
  const lastItemPublish = new Map<string, number>();
  for (const item of items) {
    const blockId = item.blockId!;
    lastItemUpdate.set(blockId, Math.max(lastItemUpdate.get(blockId) ?? 0, item.updatedAt));
    if (item.publishedAt == null) continue;
    lastItemPublish.set(blockId, Math.max(lastItemPublish.get(blockId) ?? 0, item.publishedAt));
  }
  const lastUpdate = (block: BlockRow) =>
    Math.max(block.updatedAt, lastItemUpdate.get(block.id) ?? 0);
  // A placement was last published with its block or with one of its items.
  const lastPublish = (block: BlockRow) =>
    Math.max(block.publishedAt ?? -1, lastItemPublish.get(block.id) ?? -1);
  // Placements never published, or published together, go by their last update. Remaining ties
  // go to the newest placement, whose UUIDv7 sorts last.
  const rank = (block: BlockRow) => [lastPublish(block), lastUpdate(block)];
  const later = (a: BlockRow, b: BlockRow) => {
    const [aPublished, aUpdated] = rank(a);
    const [bPublished, bUpdated] = rank(b);
    if (aPublished !== bPublished) return aPublished > bPublished;
    return aUpdated >= bUpdated;
  };
  const latest = placements.reduce((best, block) => (later(block, best) ? block : best));
  const plan = overlay.planner();
  plan.add(yield* planSharedContentFromPlacement(db, target, latest));
  plan.add(
    yield* planItemsRemoval(
      db,
      target,
      items.filter((item) => item.blockId !== latest.id),
    ),
  );
  for (const placement of placements) {
    plan.add(yield* overlay.planUpdate(db, target, blocks, placement.id, clearedPlacement));
  }
  return plan.done(undefined);
});

/**
 * Plans no longer being synced (ADR 0007), in the scope whose definitions changed: every
 * placement gets its own copy of the shared content, with fresh ids for the copied repeatable
 * items, and the shared content is deleted. On Live, drafts that copied a placement see the
 * change as a conflict; in a draft it writes draft rows and tombstones.
 */
const planStoppingBeingSynced = Effect.fn("planStoppingBeingSynced")(function* (
  db: Database,
  target: WriteTarget,
  shared: SharedContentRow,
) {
  const now = Date.now();
  const plan = overlay.planner();
  const scope = readScopeOf(target);
  const key = definitionOf(shared);
  const root: ItemRoot = { sharedContent: key };
  const items = yield* overlay.select(db, scope, repeatableItems, itemsUnder(root));
  for (const placement of yield* placementsOf(db, scope, key)) {
    const copied = { content: shared.content, settings: shared.settings };
    plan.add(yield* overlay.planUpdate(db, target, blocks, placement.id, copied));
    plan.add(yield* planItemTreeCopy(db, target, items, { blockId: placement.id }, now));
  }
  plan.add(yield* planItemsRemoval(db, target, items));
  plan.add(yield* overlay.planRemove(db, target, sharedContents, shared.id));
  return plan.done(undefined);
});

/**
 * Plans bringing a definition's shared content in line with its synced flag, in the scope whose
 * definitions changed: a synced definition without shared content becomes synced, and shared
 * content of a definition that isn't synced is copied back into its placements. Tells whether
 * the definition has shared content once the plan ran.
 */
const planSharedContentAlignment = Effect.fn("planSharedContentAlignment")(function* (
  ctx: ServiceContext,
  { target, key, synced, defaults, seedFromDefaults }: SyncedFlag & { seedFromDefaults: boolean },
) {
  const scope = readScopeOf(target);
  const shared = yield* findSharedContent(ctx.db, scope, key);
  if (shared && !synced) {
    const planned = yield* planStoppingBeingSynced(ctx.db, target, shared);
    return { ...planned, result: false };
  }
  if (!shared && synced) {
    const placed = (yield* placementsOf(ctx.db, scope, key)).length > 0;
    if (placed || seedFromDefaults) {
      const planned = yield* planBecomingSynced(ctx.db, target, key, defaults);
      return { ...planned, result: true };
    }
  }
  return overlay.nothingPlanned(!!shared);
});

/**
 * A definition's synced flag, in the target whose definitions a sync writes: Live for a release,
 * a development draft for dev mode (ADR 0006). `defaults` are the definition's as the sync
 * writes it, which shared content built from defaults starts from.
 */
type SyncedFlag = {
  target: WriteTarget;
  projectId: number;
  key: DefinitionKey;
  synced: boolean;
  defaults: DefinitionDefaults;
};

/**
 * Plans what a definition sync changing a definition's synced flag writes, from the state before
 * the sync's own writes. Tells whether the definition has shared content once the plan ran.
 */
export const planSyncedFlagChange = Effect.fn("blocks.planSyncedFlagChange")(function* (
  ctx: ServiceContext,
  flag: SyncedFlag,
) {
  return yield* planSharedContentAlignment(ctx, { ...flag, seedFromDefaults: true });
});

/**
 * Plans what a definition sync creating a definition writes, maybe for one coming back to
 * content stored under its name. A new synced definition that isn't placed yet gets its shared
 * content from its first placement, like a layout declaring it, rather than from its defaults.
 * Tells whether the definition has shared content once the plan ran.
 */
export const planNewDefinitionSyncedFlag = Effect.fn("blocks.planNewDefinitionSyncedFlag")(
  function* (ctx: ServiceContext, flag: SyncedFlag) {
    return yield* planSharedContentAlignment(ctx, { ...flag, seedFromDefaults: false });
  },
);

/** A repeatable item a definition sync declares, under a placement, by temporary ids. */
type DeclaredItem = {
  tempId: string;
  parentTempId: string | null;
  fieldName: string;
  content: unknown;
  settings?: unknown;
  position: string;
};

/**
 * Plans a new placement a definition sync declares (a layout's block, or the homepage's), with
 * its repeatable items, in the sync's target. The sync knows its definition as it will be once
 * its batch ran, which the target can't tell yet: whether it is `synced`, and whether it
 * `hasSharedContent`. Then, like `planSharedContentAdoption`, the placement keeps its `own`
 * content, `seeded` the shared content, or `adopted` existing shared content: a placement
 * showing shared content is created cleared, without items of its own.
 */
export const planDeclaredPlacement = Effect.fn("blocks.planDeclaredPlacement")(function* (
  db: Database,
  target: WriteTarget,
  values: Pick<
    typeof blocks.$inferInsert,
    "projectId" | "pageId" | "layoutId" | "type" | "content" | "settings" | "slot" | "position"
  >,
  items: readonly DeclaredItem[],
  definition: { synced: boolean; hasSharedContent: boolean },
) {
  const now = Date.now();
  const plan = overlay.planner();
  const timestamps = { createdAt: now, updatedAt: now };
  const key = definitionOf(values);
  const adoption = definition.hasSharedContent
    ? ("adopted" as const)
    : definition.synced
      ? ("seeded" as const)
      : ("own" as const);
  const own = { content: values.content, settings: values.settings ?? null };
  if (adoption === "seeded") plan.add(yield* planSharedContentInsert(db, target, key, own));
  // A fresh id, so the target can't already hold the block or its items.
  const block = plan.add(
    yield* overlay.planInsert(db, target, blocks, {
      ...values,
      ...(adoption === "own" ? own : clearedPlacement),
      ...timestamps,
    }),
  )!;
  const root: ItemRoot = adoption === "seeded" ? { sharedContent: key } : { blockId: block.id };
  const planned: ItemRow[] = [];
  if (adoption !== "adopted") {
    const ids = new Map<string, string>();
    for (const item of items) {
      const row = plan.add(
        yield* overlay.planInsert(
          db,
          target,
          repeatableItems,
          {
            ...rootColumns(root),
            parentItemId: item.parentTempId ? (ids.get(item.parentTempId) ?? null) : null,
            fieldName: item.fieldName,
            content: item.content,
            settings: item.settings ?? null,
            position: item.position,
            ...timestamps,
          },
          // The block is created in the same batch, so its project can't be read from it.
          { projectId: values.projectId },
        ),
      )!;
      ids.set(item.tempId, row.id);
      planned.push(row);
    }
  }
  return plan.done({ block, items: planned, adoption });
});

/**
 * Plans making a new placement, written to `target`, show its definition's shared content as
 * that target reads it. The placement's own content seeds the shared content when a synced
 * definition has none yet, and is dropped otherwise. Tells which happens: the placement keeps
 * its `own` content, `seeded` the shared content, or `adopted` existing shared content.
 *
 * The placement's items, and the placement itself for clearing it, are read from the target: a
 * placement inserted in the same batch has neither yet, so plan it already cleared.
 */
const planSharedContentAdoption = Effect.fn("blocks.planSharedContentAdoption")(function* (
  ctx: ServiceContext,
  target: WriteTarget,
  block: BlockRow,
) {
  const plan = overlay.planner();
  const scope = readScopeOf(target);
  const key = definitionOf(block);
  const clear = overlay.planUpdate(ctx.db, target, blocks, block.id, clearedPlacement);
  if (yield* findSharedContent(ctx.db, scope, key)) {
    const items = yield* itemsOfPlacements(ctx.db, scope, [block.id]);
    plan.add(yield* planItemsRemoval(ctx.db, target, items));
    plan.add(yield* clear);
    return plan.done("adopted" as const);
  }
  if (!(yield* findDefinition(ctx.db, key, scope))?.synced) {
    return overlay.nothingPlanned("own" as const);
  }
  plan.add(yield* planSharedContentFromPlacement(ctx.db, target, block));
  plan.add(yield* clear);
  return plan.done("seeded" as const);
});

/**
 * Makes a new placement, written to `target`, show its definition's shared content as that
 * target reads it. The placement's own content seeds the shared content when a synced definition
 * has none yet, and is dropped otherwise. Tells which happened: the placement keeps its `own`
 * content, `seeded` the shared content, or `adopted` existing shared content.
 */
export const adoptSharedContent = Effect.fn("blocks.adoptSharedContent")(function* (
  ctx: ServiceContext,
  target: WriteTarget,
  block: BlockRow,
) {
  return yield* overlay.runPlanned(ctx.db, yield* planSharedContentAdoption(ctx, target, block));
});

/**
 * A placement through which a synced definition's shared content reads in a scope. Nothing when
 * the definition isn't synced or isn't placed.
 */
export const sharedPlacementId = Effect.fn("blocks.sharedPlacementId")(function* (
  db: Database,
  scope: ReadScope,
  key: DefinitionKey,
) {
  if (!(yield* findSharedContent(db, scope, key))) return null;
  const [first] = yield* placementsOf(db, scope, key);
  return first?.id ?? null;
});
