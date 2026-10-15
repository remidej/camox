import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { assertSyncAccess } from "../../authorization";
import { decodeInput } from "../../lib/errors";
import { resolveEnvironment } from "../../lib/resolve-environment";
import { stableStringify } from "../../lib/stable-stringify";
import { blockDefinitions } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { applyNewDefinitionSyncedFlag, applySyncedFlagChange } from "../blocks/shared-content";
import { validateReferenceSchema } from "../collections/references";

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

/** A block definition is identified by its name within a project's environment. */
function definitionScope(projectId: number, environmentId: number, blockId: string) {
  return and(
    eq(blockDefinitions.projectId, projectId),
    eq(blockDefinitions.environmentId, environmentId),
    eq(blockDefinitions.blockId, blockId),
  );
}

type DefinitionFields = z.infer<z.ZodObject<typeof definitionFields>>;

/** The stored columns a synced definition sets. */
function definitionColumns(def: DefinitionFields) {
  return {
    title: def.title,
    description: def.description,
    contentSchema: def.contentSchema,
    settingsSchema: def.settingsSchema ?? null,
    defaultContent: def.defaultContent ?? null,
    defaultSettings: def.defaultSettings ?? null,
    layoutOnly: def.layoutOnly ?? null,
    synced: def.synced ?? false,
  };
}

function definitionChanged(
  existing: typeof blockDefinitions.$inferSelect,
  columns: ReturnType<typeof definitionColumns>,
) {
  return Object.entries(columns).some(
    ([key, value]) =>
      stableStringify(existing[key as keyof typeof columns]) !== stableStringify(value),
  );
}

// --- Reads ---

export const listBlockDefinitions = Effect.fn("blockDefinitions.listBlockDefinitions")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listBlockDefinitionsInput>,
) {
  const { projectId } = yield* decodeInput(listBlockDefinitionsInput, rawInput);
  const environment = yield* resolveEnvironment(ctx.db, projectId, ctx.environmentName);
  return yield* Effect.promise(() =>
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
});

// --- Writes ---

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
  const project = yield* assertSyncAccess(ctx.db, projectSlug, {
    user: ctx.user,
    environmentName: ctx.environmentName,
    deployToken: input.deployToken,
  });
  const projectId = project.id;
  const environment = yield* resolveEnvironment(ctx.db, projectId, ctx.environmentName, {
    autoCreate,
  });
  const now = Date.now();
  const results = [];

  for (const def of definitions) {
    const existing = yield* Effect.promise(() =>
      ctx.db
        .select()
        .from(blockDefinitions)
        .where(definitionScope(projectId, environment.id, def.blockId))
        .get(),
    );

    if (existing) {
      const fields = definitionColumns(def);
      // Syncing an unchanged definition writes nothing.
      if (!definitionChanged(existing, fields)) {
        results.push(existing);
        continue;
      }
      const updated = yield* Effect.promise(() =>
        ctx.db
          .update(blockDefinitions)
          .set({ ...fields, updatedAt: now })
          .where(definitionScope(projectId, environment.id, def.blockId))
          .returning()
          .get(),
      );
      if (updated.synced !== existing.synced) {
        yield* applySyncedFlagChange(ctx, {
          projectId,
          key: { environmentId: environment.id, type: def.blockId },
          synced: updated.synced,
        });
      }
      results.push(updated);
      continue;
    }

    const created = yield* Effect.promise(() =>
      ctx.db
        .insert(blockDefinitions)
        .values({
          projectId,
          environmentId: environment.id,
          blockId: def.blockId,
          title: def.title,
          description: def.description,
          contentSchema: def.contentSchema,
          settingsSchema: def.settingsSchema ?? null,
          defaultContent: def.defaultContent ?? null,
          defaultSettings: def.defaultSettings ?? null,
          layoutOnly: def.layoutOnly ?? null,
          synced: def.synced ?? false,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get(),
    );
    // A definition that comes back finds its stored shared content, synced or not.
    yield* applyNewDefinitionSyncedFlag(ctx, {
      projectId,
      key: { environmentId: environment.id, type: def.blockId },
      synced: created.synced,
    });
    results.push(created);
  }

  // Reconcile orphans: definitions still in the DB whose block files are gone
  // from code. layoutOnly definitions are skipped here — syncLayouts owns them
  // because it knows which types each layout currently references and prunes
  // both the layout-scoped block rows and their definitions atomically.
  const incomingIds = new Set(definitions.map((d) => d.blockId));
  const existingDefs = yield* Effect.promise(() =>
    ctx.db
      .select({
        blockId: blockDefinitions.blockId,
        layoutOnly: blockDefinitions.layoutOnly,
      })
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, projectId),
          eq(blockDefinitions.environmentId, environment.id),
        ),
      ),
  );
  const orphans = existingDefs.filter((d) => !incomingIds.has(d.blockId) && d.layoutOnly !== true);

  // Blocks of a removed definition stay stored under its name, render nothing, and come
  // back with it.
  const deletedDefinitionTypes = orphans.map((orphan) => orphan.blockId);
  for (const blockId of deletedDefinitionTypes) {
    yield* Effect.promise(() =>
      ctx.db.delete(blockDefinitions).where(definitionScope(projectId, environment.id, blockId)),
    );
  }

  return {
    results,
    environmentCreated: environment.created,
    deletedDefinitionTypes,
  };
});

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
  const project = yield* assertSyncAccess(ctx.db, projectSlug, {
    user: ctx.user,
    environmentName: ctx.environmentName,
    deployToken,
  });
  const projectId = project.id;
  const environment = yield* resolveEnvironment(ctx.db, projectId, ctx.environmentName, {
    autoCreate: true,
  });
  const now = Date.now();

  const existing = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(definitionScope(projectId, environment.id, body.blockId))
      .get(),
  );

  if (existing) {
    const result = yield* Effect.promise(() =>
      ctx.db
        .update(blockDefinitions)
        .set({ ...definitionColumns(body), updatedAt: now })
        .where(definitionScope(projectId, environment.id, body.blockId))
        .returning()
        .get(),
    );
    if (result.synced !== existing.synced) {
      yield* applySyncedFlagChange(ctx, {
        projectId,
        key: { environmentId: environment.id, type: body.blockId },
        synced: result.synced,
      });
    }
    return { ...result, action: "updated" as const };
  }

  const result = yield* Effect.promise(() =>
    ctx.db
      .insert(blockDefinitions)
      .values({
        ...body,
        projectId,
        environmentId: environment.id,
        settingsSchema: body.settingsSchema ?? null,
        defaultContent: body.defaultContent ?? null,
        defaultSettings: body.defaultSettings ?? null,
        layoutOnly: body.layoutOnly ?? null,
        synced: body.synced ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get(),
  );
  yield* applyNewDefinitionSyncedFlag(ctx, {
    projectId,
    key: { environmentId: environment.id, type: body.blockId },
    synced: result.synced,
  });
  return { ...result, action: "created" as const };
});

export const deleteBlockDefinition = Effect.fn("blockDefinitions.deleteBlockDefinition")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteBlockDefinitionInput>,
) {
  const { projectSlug, deployToken, blockId } = yield* decodeInput(
    deleteBlockDefinitionInput,
    rawInput,
  );
  const project = yield* assertSyncAccess(ctx.db, projectSlug, {
    user: ctx.user,
    environmentName: ctx.environmentName,
    deployToken,
  });
  const environment = yield* resolveEnvironment(ctx.db, project.id, ctx.environmentName);
  const result = yield* Effect.promise(() =>
    ctx.db
      .delete(blockDefinitions)
      .where(definitionScope(project.id, environment.id, blockId))
      .returning()
      .get(),
  );
  return { deleted: !!result, blockId };
});
