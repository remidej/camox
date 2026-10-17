import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { assertSyncAccess } from "../../authorization";
import { decodeInput } from "../../lib/errors";
import { stableStringify } from "../../lib/stable-stringify";
import { blockDefinitions } from "../../schema";
import { definitionsDraftOf, definitionsIn } from "../_shared/definitions";
import { blockSchemaHash } from "../_shared/schema-hash";
import type { ServiceContext } from "../_shared/service-context";
import { applyNewDefinitionSyncedFlag, applySyncedFlagChange } from "../blocks/shared-content";
import { validateReferenceSchema } from "../collections/references";
import { accessTo } from "../drafts/access";
import type { DraftScope, WriteTarget } from "../drafts/scope";

// --- Input Schemas ---
// Exported so adapters (oRPC, MCP, CLI) share the same canonical contract.
// Services .parse() them on entry — service is the trust boundary.

const definitionFields = {
  blockId: z.string(),
  title: z.string(),
  description: z.string(),
  contentSchema: z.unknown(),
  settingsSchema: z.unknown().optional(),
  defaultContent: z.unknown().optional(),
  defaultSettings: z.unknown().optional(),
  layoutOnly: z.boolean().optional(),
  synced: z.boolean().optional(),
};

export const listBlockDefinitionsInput = z.object({ projectId: z.number() });

export const syncBlockDefinitionsInput = z.object({
  projectSlug: z.string(),
  deployToken: z.string().optional(),
  autoCreate: z.boolean(),
  definitions: z.array(z.object(definitionFields)),
});

export const upsertBlockDefinitionInput = z.object({
  projectSlug: z.string(),
  deployToken: z.string().optional(),
  ...definitionFields,
});

export const deleteBlockDefinitionInput = z.object({
  projectSlug: z.string(),
  deployToken: z.string().optional(),
  blockId: z.string(),
});

/**
 * A block definition is identified by its name within a project, in the set a
 * scope reads: Live's, or a development draft's (ADR 0006).
 */
function definitionScope(projectId: number, scope: DraftScope, blockId: string) {
  return and(
    eq(blockDefinitions.projectId, projectId),
    definitionsIn(blockDefinitions, scope),
    eq(blockDefinitions.blockId, blockId),
  );
}

type DefinitionFields = z.infer<z.ZodObject<typeof definitionFields>>;

/** The stored columns a synced definition sets. */
async function definitionColumns(def: DefinitionFields) {
  return {
    title: def.title,
    description: def.description,
    contentSchema: def.contentSchema,
    settingsSchema: def.settingsSchema ?? null,
    defaultContent: def.defaultContent ?? null,
    defaultSettings: def.defaultSettings ?? null,
    layoutOnly: def.layoutOnly ?? null,
    synced: def.synced ?? false,
    schemaHash: await blockSchemaHash(def),
  };
}

type DefinitionColumns = Awaited<ReturnType<typeof definitionColumns>>;

function definitionChanged(
  existing: typeof blockDefinitions.$inferSelect,
  columns: DefinitionColumns,
) {
  return Object.entries(columns).some(
    ([key, value]) =>
      stableStringify(existing[key as keyof typeof columns]) !== stableStringify(value),
  );
}

// --- Reads ---

/** The block definitions the request's draft scope reads: a development draft's, else Live's. */
export const listBlockDefinitions = Effect.fn("blockDefinitions.listBlockDefinitions")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listBlockDefinitionsInput>,
) {
  const { projectId } = yield* decodeInput(listBlockDefinitionsInput, rawInput);
  const { scope } = yield* accessTo(ctx, { project: projectId }, "public");
  return yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(
        and(eq(blockDefinitions.projectId, projectId), definitionsIn(blockDefinitions, scope)),
      ),
  );
}, Effect.scoped);

// --- Writes ---

/**
 * Writes a definition in the sync's target, then aligns its shared content with its synced flag
 * there: Live for a release, the development draft for dev mode (ADR 0006, ADR 0007).
 */
const writeDefinition = Effect.fn("blockDefinitions.writeDefinition")(function* (
  ctx: ServiceContext,
  target: { projectId: number; scope: DraftScope; writes: WriteTarget },
  def: DefinitionFields,
  now: number,
) {
  const { projectId, scope, writes } = target;
  const key = { projectId, type: def.blockId };
  const fields = yield* Effect.promise(() => definitionColumns(def));
  const existing = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(definitionScope(projectId, scope, def.blockId))
      .get(),
  );

  if (existing) {
    // Syncing an unchanged definition writes nothing.
    if (!definitionChanged(existing, fields))
      return { row: existing, action: "unchanged" as const };
    const updated = yield* Effect.promise(() =>
      ctx.db
        .update(blockDefinitions)
        .set({ ...fields, updatedAt: now })
        .where(definitionScope(projectId, scope, def.blockId))
        .returning()
        .get(),
    );
    if (updated.synced !== existing.synced) {
      yield* applySyncedFlagChange(ctx, {
        target: writes,
        projectId,
        key,
        synced: updated.synced,
      });
    }
    return { row: updated, action: "updated" as const };
  }

  const created = yield* Effect.promise(() =>
    ctx.db
      .insert(blockDefinitions)
      .values({
        ...fields,
        draftId: definitionsDraftOf(scope),
        projectId,
        blockId: def.blockId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get(),
  );
  // A definition that comes back finds its stored shared content, synced or not.
  yield* applyNewDefinitionSyncedFlag(ctx, {
    target: writes,
    projectId,
    key,
    synced: created.synced,
  });
  return { row: created, action: "created" as const };
});

/**
 * Replaces the whole set of block definitions in the sync's target: Live for a release with the
 * deploy token, or the caller's development draft for dev mode, which the first sync creates.
 * Content never blocks it (ADR 0006, ADR 0007).
 */
export const syncBlockDefinitions = Effect.fn("blockDefinitions.syncBlockDefinitions")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof syncBlockDefinitionsInput>,
) {
  const input = yield* decodeInput(syncBlockDefinitionsInput, rawInput);
  const { projectSlug, definitions, autoCreate } = input;
  for (const definition of definitions) {
    yield* validateReferenceSchema(definition.contentSchema);
    yield* validateReferenceSchema(definition.settingsSchema, false);
  }
  const target = yield* assertSyncAccess(
    ctx.db,
    projectSlug,
    { user: ctx.user, draft: ctx.draft, deployToken: input.deployToken },
    { create: autoCreate },
  );
  const projectId = target.project.id;
  const { scope, writes } = target;
  const now = Date.now();
  const results = [];

  for (const def of definitions) {
    const written = yield* writeDefinition(ctx, { projectId, scope, writes }, def, now);
    results.push(written.row);
  }

  // Reconcile orphans: definitions still in the set whose block files are gone from code.
  // layoutOnly definitions are skipped here — syncLayouts owns them because it knows which
  // types each layout currently references and prunes both the layout-scoped block rows and
  // their definitions atomically.
  const incomingIds = new Set(definitions.map((d) => d.blockId));
  const existingDefs = yield* Effect.promise(() =>
    ctx.db
      .select({
        blockId: blockDefinitions.blockId,
        layoutOnly: blockDefinitions.layoutOnly,
      })
      .from(blockDefinitions)
      .where(
        and(eq(blockDefinitions.projectId, projectId), definitionsIn(blockDefinitions, scope)),
      ),
  );
  const orphans = existingDefs.filter((d) => !incomingIds.has(d.blockId) && d.layoutOnly !== true);

  // Blocks of a removed definition stay stored under its name, render nothing, and come
  // back with it.
  const deletedDefinitionTypes = orphans.map((orphan) => orphan.blockId);
  for (const blockId of deletedDefinitionTypes) {
    yield* Effect.promise(() =>
      ctx.db.delete(blockDefinitions).where(definitionScope(projectId, scope, blockId)),
    );
  }

  return {
    results,
    draftCreated: target.draftCreated,
    deletedDefinitionTypes,
  };
});

/** Writes one block definition in the sync's target, as `syncBlockDefinitions` does. */
export const upsertBlockDefinition = Effect.fn("blockDefinitions.upsertBlockDefinition")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof upsertBlockDefinitionInput>,
) {
  const { projectSlug, deployToken, ...body } = yield* decodeInput(
    upsertBlockDefinitionInput,
    rawInput,
  );
  yield* validateReferenceSchema(body.contentSchema);
  yield* validateReferenceSchema(body.settingsSchema, false);
  const target = yield* assertSyncAccess(
    ctx.db,
    projectSlug,
    { user: ctx.user, draft: ctx.draft, deployToken },
    { create: true },
  );
  const projectId = target.project.id;
  const written = yield* writeDefinition(
    ctx,
    { projectId, scope: target.scope, writes: target.writes },
    body,
    Date.now(),
  );
  const action = written.action === "created" ? "created" : "updated";
  return { ...written.row, action: action as "created" | "updated" };
});

export const deleteBlockDefinition = Effect.fn("blockDefinitions.deleteBlockDefinition")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteBlockDefinitionInput>,
) {
  const { projectSlug, deployToken, blockId } = yield* decodeInput(
    deleteBlockDefinitionInput,
    rawInput,
  );
  const target = yield* assertSyncAccess(ctx.db, projectSlug, {
    user: ctx.user,
    draft: ctx.draft,
    deployToken,
  });
  const result = yield* Effect.promise(() =>
    ctx.db
      .delete(blockDefinitions)
      .where(definitionScope(target.project.id, target.scope, blockId))
      .returning()
      .get(),
  );
  return { deleted: !!result, blockId };
});
