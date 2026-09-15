import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { assertSyncAccess } from "../../authorization";
import { resolveEnvironment } from "../../lib/resolve-environment";
import { blockDefinitions, blocks, layouts, pages } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { reconcileSyncedDefinition } from "../blocks/synced";

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

export async function listBlockDefinitions(
  ctx: ServiceContext,
  rawInput: z.input<typeof listBlockDefinitionsInput>,
) {
  const { projectId } = listBlockDefinitionsInput.parse(rawInput);
  const environment = await resolveEnvironment(ctx.db, projectId, ctx.environmentName);
  return ctx.db
    .select()
    .from(blockDefinitions)
    .where(
      and(
        eq(blockDefinitions.projectId, projectId),
        eq(blockDefinitions.environmentId, environment.id),
      ),
    );
}

// --- Writes ---

export async function syncBlockDefinitions(
  ctx: ServiceContext,
  rawInput: z.input<typeof syncBlockDefinitionsInput>,
) {
  const input = syncBlockDefinitionsInput.parse(rawInput);
  const { projectSlug, definitions, autoCreate } = input;
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

  for (const def of definitions) {
    const existing = await ctx.db
      .select()
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, projectId),
          eq(blockDefinitions.environmentId, environment.id),
          eq(blockDefinitions.blockId, def.blockId),
        ),
      )
      .get();

    if (existing) {
      const updated = await ctx.db
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
        .get();
      if (updated.synced && !existing.synced) {
        await reconcileSyncedDefinition(ctx, environment.id, def.blockId);
      }
      results.push(updated);
      continue;
    }

    const created = await ctx.db
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
      .get();
    if (created.synced) await reconcileSyncedDefinition(ctx, environment.id, def.blockId);
    results.push(created);
  }

  // Reconcile orphans: definitions still in the DB whose block files are gone
  // from code. layoutOnly definitions are skipped here — syncLayouts owns them
  // because it knows which types each layout currently references and prunes
  // both the layout-scoped block rows and their definitions atomically.
  const incomingIds = new Set(definitions.map((d) => d.blockId));
  const existingDefs = await ctx.db
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
    );
  const orphans = existingDefs.filter((d) => !incomingIds.has(d.blockId) && d.layoutOnly !== true);

  const deletedDefinitionTypes: string[] = [];
  const blockedDefinitionDeletions: Array<{ blockId: string; blockCount: number }> = [];

  for (const orphan of orphans) {
    // A block instance is attached to either a page or a layout (the column
    // not in use is null), so usage is the union of both joins scoped to this
    // environment.
    const pageUses = await ctx.db
      .select({ id: blocks.id })
      .from(blocks)
      .innerJoin(pages, eq(blocks.pageId, pages.id))
      .where(and(eq(blocks.type, orphan.blockId), eq(pages.environmentId, environment.id)));
    const layoutUses = await ctx.db
      .select({ id: blocks.id })
      .from(blocks)
      .innerJoin(layouts, eq(blocks.layoutId, layouts.id))
      .where(and(eq(blocks.type, orphan.blockId), eq(layouts.environmentId, environment.id)));
    const usageCount = pageUses.length + layoutUses.length;

    if (usageCount > 0) {
      blockedDefinitionDeletions.push({ blockId: orphan.blockId, blockCount: usageCount });
      continue;
    }
    await ctx.db.delete(blockDefinitions).where(eq(blockDefinitions.id, orphan.id));
    deletedDefinitionTypes.push(orphan.blockId);
  }

  return {
    results,
    environmentCreated: environment.created,
    deletedDefinitionTypes,
    blockedDefinitionDeletions,
  };
}

export async function upsertBlockDefinition(
  ctx: ServiceContext,
  rawInput: z.input<typeof upsertBlockDefinitionInput>,
) {
  const { projectSlug, deployToken, ...body } = upsertBlockDefinitionInput.parse(rawInput);
  const project = await assertSyncAccess(ctx.db, projectSlug, {
    user: ctx.user,
    environmentName: ctx.environmentName,
    deployToken,
  });
  const projectId = project.id;
  const environment = await resolveEnvironment(ctx.db, projectId, ctx.environmentName, {
    autoCreate: true,
  });
  const now = Date.now();

  const existing = await ctx.db
    .select()
    .from(blockDefinitions)
    .where(
      and(
        eq(blockDefinitions.projectId, projectId),
        eq(blockDefinitions.environmentId, environment.id),
        eq(blockDefinitions.blockId, body.blockId),
      ),
    )
    .get();

  if (existing) {
    const result = await ctx.db
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
      .get();
    if (result.synced && !existing.synced) {
      await reconcileSyncedDefinition(ctx, environment.id, body.blockId);
    }
    return { ...result, action: "updated" as const };
  }

  const result = await ctx.db
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
    .get();
  if (result.synced) await reconcileSyncedDefinition(ctx, environment.id, body.blockId);
  return { ...result, action: "created" as const };
}

export async function deleteBlockDefinition(
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteBlockDefinitionInput>,
) {
  const { projectSlug, deployToken, blockId } = deleteBlockDefinitionInput.parse(rawInput);
  const project = await assertSyncAccess(ctx.db, projectSlug, {
    user: ctx.user,
    environmentName: ctx.environmentName,
    deployToken,
  });
  const environment = await resolveEnvironment(ctx.db, project.id, ctx.environmentName);
  const result = await ctx.db
    .delete(blockDefinitions)
    .where(
      and(
        eq(blockDefinitions.projectId, project.id),
        eq(blockDefinitions.environmentId, environment.id),
        eq(blockDefinitions.blockId, blockId),
      ),
    )
    .returning()
    .get();
  return { deleted: !!result, blockId };
}
