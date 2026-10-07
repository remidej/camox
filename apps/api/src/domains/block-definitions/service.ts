import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { assertSyncAccess } from "../../authorization";
import { decodeInput } from "../../lib/errors";
import { resolveEnvironment } from "../../lib/resolve-environment";
import { blockDefinitions, blocks, layouts, pages } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { reconcileSyncedDefinition } from "../blocks/synced";
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
        .where(
          and(
            eq(blockDefinitions.projectId, projectId),
            eq(blockDefinitions.environmentId, environment.id),
            eq(blockDefinitions.blockId, def.blockId),
          ),
        )
        .get(),
    );

    if (existing) {
      const updated = yield* Effect.promise(() =>
        ctx.db
          .update(blockDefinitions)
          .set({
            title: def.title,
            description: def.description,
            contentSchema: def.contentSchema,
            settingsSchema: def.settingsSchema ?? null,
            defaultContent: def.defaultContent ?? null,
            defaultSettings: def.defaultSettings ?? null,
            layoutOnly: def.layoutOnly ?? null,
            synced: def.synced ?? false,
            updatedAt: now,
          })
          .where(eq(blockDefinitions.id, existing.id))
          .returning()
          .get(),
      );
      if (updated.synced && !existing.synced) {
        yield* reconcileSyncedDefinition(ctx, environment.id, def.blockId);
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
    if (created.synced) yield* reconcileSyncedDefinition(ctx, environment.id, def.blockId);
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
        id: blockDefinitions.id,
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

  const deletedDefinitionTypes: string[] = [];
  const blockedDefinitionDeletions: Array<{ blockId: string; blockCount: number }> = [];

  for (const orphan of orphans) {
    // A block is attached to either a page or a layout (the column
    // not in use is null), so usage is the union of both joins scoped to this
    // environment.
    const pageUses = yield* Effect.promise(() =>
      ctx.db
        .select({ id: blocks.id })
        .from(blocks)
        .innerJoin(pages, eq(blocks.pageId, pages.id))
        .where(and(eq(blocks.type, orphan.blockId), eq(pages.environmentId, environment.id))),
    );
    const layoutUses = yield* Effect.promise(() =>
      ctx.db
        .select({ id: blocks.id })
        .from(blocks)
        .innerJoin(layouts, eq(blocks.layoutId, layouts.id))
        .where(and(eq(blocks.type, orphan.blockId), eq(layouts.environmentId, environment.id))),
    );
    const usageCount = pageUses.length + layoutUses.length;

    if (usageCount > 0) {
      blockedDefinitionDeletions.push({ blockId: orphan.blockId, blockCount: usageCount });
      continue;
    }
    yield* Effect.promise(() =>
      ctx.db.delete(blockDefinitions).where(eq(blockDefinitions.id, orphan.id)),
    );
    deletedDefinitionTypes.push(orphan.blockId);
  }

  return {
    results,
    environmentCreated: environment.created,
    deletedDefinitionTypes,
    blockedDefinitionDeletions,
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
      .where(
        and(
          eq(blockDefinitions.projectId, projectId),
          eq(blockDefinitions.environmentId, environment.id),
          eq(blockDefinitions.blockId, body.blockId),
        ),
      )
      .get(),
  );

  if (existing) {
    const result = yield* Effect.promise(() =>
      ctx.db
        .update(blockDefinitions)
        .set({
          title: body.title,
          description: body.description,
          contentSchema: body.contentSchema,
          settingsSchema: body.settingsSchema ?? null,
          defaultContent: body.defaultContent ?? null,
          defaultSettings: body.defaultSettings ?? null,
          layoutOnly: body.layoutOnly ?? null,
          synced: body.synced ?? false,
          updatedAt: now,
        })
        .where(eq(blockDefinitions.id, existing.id))
        .returning()
        .get(),
    );
    if (result.synced && !existing.synced) {
      yield* reconcileSyncedDefinition(ctx, environment.id, body.blockId);
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
  if (result.synced) yield* reconcileSyncedDefinition(ctx, environment.id, body.blockId);
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
      .where(
        and(
          eq(blockDefinitions.projectId, project.id),
          eq(blockDefinitions.environmentId, environment.id),
          eq(blockDefinitions.blockId, blockId),
        ),
      )
      .returning()
      .get(),
  );
  return { deleted: !!result, blockId };
});
