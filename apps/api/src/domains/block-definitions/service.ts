import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import type { SyncTarget } from "../../authorization";
import { decodeInput } from "../../lib/errors";
import { stableStringify } from "../../lib/stable-stringify";
import { blockDefinitions, sharedContents } from "../../schema";
import { definitionsDraftOf, definitionsIn } from "../_shared/definitions";
import { blockSchemaHash } from "../_shared/schema-hash";
import type { ServiceContext } from "../_shared/service-context";
import { planNewDefinitionSyncedFlag, planSyncedFlagChange } from "../blocks/shared-content";
import { validateReferenceSchema } from "../collections/references";
import { accessTo } from "../drafts/access";
import * as overlay from "../drafts/overlay";

// --- Input Schemas ---
// Exported so adapters (oRPC, MCP, CLI) share the same canonical contract.
// Services .parse() them on entry — service is the trust boundary.

/** A block definition as a Definition Set holds it. */
export const blockDefinitionInput = z.object({
  blockId: z.string(),
  title: z.string(),
  description: z.string(),
  contentSchema: z.unknown(),
  settingsSchema: z.unknown().optional(),
  defaultContent: z.unknown().optional(),
  defaultSettings: z.unknown().optional(),
  layoutOnly: z.boolean().optional(),
  synced: z.boolean().optional(),
});

export const listBlockDefinitionsInput = z.object({ projectId: z.number() });

type DefinitionFields = z.infer<typeof blockDefinitionInput>;

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

// --- Definition sync ---

/** Fails on a definition whose schemas reference collections the wrong way, before any write. */
export const validateBlockDefinitions = Effect.fn("blockDefinitions.validate")(function* (
  definitions: readonly DefinitionFields[],
) {
  for (const definition of definitions) {
    yield* validateReferenceSchema(definition.contentSchema);
    yield* validateReferenceSchema(definition.settingsSchema, false);
  }
});

/** A block definition as its target holds it once a sync ran. */
type SyncedDefinition = {
  contentSchema: unknown;
  settingsSchema: unknown;
  synced: boolean;
  layoutOnly: boolean;
  /** Whether its shared content exists once the sync's block definitions are written. */
  hasSharedContent: boolean;
};

/** The block definitions of a sync's target as they are once its batch ran, by name. */
export type SyncedDefinitions = Map<string, SyncedDefinition>;

/**
 * Plans replacing the whole set of block definitions in a sync's target: Live for a release, or
 * the development draft for dev mode. Each definition's shared content follows its synced flag.
 * Content never blocks it (ADR 0006, ADR 0007).
 *
 * Tells the definitions the target holds once the plan ran, for the parts of the sync planned
 * after it, which can't read them from the target before the batch runs.
 */
export const planBlockDefinitions = Effect.fn("blockDefinitions.plan")(function* (
  ctx: ServiceContext,
  { project, scope, writes }: SyncTarget,
  definitions: readonly DefinitionFields[],
  now: number,
) {
  const projectId = project.id;
  const plan = overlay.planner();
  const inTarget = and(
    eq(blockDefinitions.projectId, projectId),
    definitionsIn(blockDefinitions, scope),
  );
  const existing = yield* Effect.promise(() =>
    ctx.db.select().from(blockDefinitions).where(inTarget),
  );
  const existingByType = new Map(existing.map((row) => [row.blockId, row]));
  const shared = yield* overlay.select(
    ctx.db,
    scope,
    sharedContents,
    eq(sharedContents.projectId, projectId),
  );
  const sharedTypes = new Set(shared.map((row) => row.type));
  const synced: SyncedDefinitions = new Map();
  // The content schemas of the definitions it creates or whose content schema it changes, by
  // name: content stored under their names is read through a new schema from then on.
  const reshaped = new Map<string, unknown>();
  const keep = (
    type: string,
    columns: Pick<SyncedDefinition, "contentSchema" | "settingsSchema" | "synced"> & {
      layoutOnly: boolean | null;
    },
    hasSharedContent: boolean,
  ) =>
    synced.set(type, {
      contentSchema: columns.contentSchema,
      settingsSchema: columns.settingsSchema,
      synced: columns.synced,
      layoutOnly: !!columns.layoutOnly,
      hasSharedContent,
    });

  for (const def of definitions) {
    const key = { projectId, type: def.blockId };
    const fields = yield* Effect.promise(() => definitionColumns(def));
    const flag = { target: writes, projectId, key, synced: fields.synced, defaults: def };
    const stored = existingByType.get(def.blockId);
    let hasSharedContent = sharedTypes.has(def.blockId);
    if (
      !stored ||
      stableStringify(stored.contentSchema) !== stableStringify(fields.contentSchema)
    ) {
      reshaped.set(def.blockId, fields.contentSchema);
    }
    if (!stored) {
      plan.add(
        overlay.plannedStatements(
          ctx.db.insert(blockDefinitions).values({
            ...fields,
            draftId: definitionsDraftOf(scope),
            projectId,
            blockId: def.blockId,
            createdAt: now,
            updatedAt: now,
          }),
        ),
      );
      // A definition that comes back finds its stored shared content, synced or not.
      hasSharedContent = plan.add(yield* planNewDefinitionSyncedFlag(ctx, flag));
    } else if (definitionChanged(stored, fields)) {
      // Syncing an unchanged definition writes nothing.
      plan.add(
        overlay.plannedStatements(
          ctx.db
            .update(blockDefinitions)
            .set({ ...fields, updatedAt: now })
            .where(eq(blockDefinitions.rowId, stored.rowId)),
        ),
      );
      if (stored.synced !== fields.synced) {
        hasSharedContent = plan.add(yield* planSyncedFlagChange(ctx, flag));
      }
    }
    keep(def.blockId, fields, hasSharedContent);
  }

  // Reconcile orphans: definitions still in the set whose block files are gone from code.
  // Layout-only definitions are kept here: the layouts part of the sync knows which types each
  // layout still declares, and drops those no layout uses.
  const deletedDefinitionTypes: string[] = [];
  for (const row of existing) {
    if (synced.has(row.blockId)) continue;
    if (row.layoutOnly) {
      keep(row.blockId, row, sharedTypes.has(row.blockId));
      continue;
    }
    // Blocks of a removed definition stay stored under its name, render nothing, and come
    // back with it.
    deletedDefinitionTypes.push(row.blockId);
    plan.add(
      overlay.plannedStatements(
        ctx.db.delete(blockDefinitions).where(eq(blockDefinitions.rowId, row.rowId)),
      ),
    );
  }

  return plan.done({ definitions: synced, deletedDefinitionTypes, reshaped });
});
