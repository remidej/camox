import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { assertSyncAccess, recordDefinitionsSynced, type SyncTarget } from "../../authorization";
import { decodeInput, NotFoundError } from "../../lib/errors";
import type { ServiceContext } from "../_shared/service-context";
import { contentArtifactSources } from "../artifact-sources/content-sources";
import {
  declaredArtifactSources,
  defaultArtifactSources,
  hasArtifactFields,
  storingSources,
} from "../artifact-sources/store";
import {
  blockDefinitionInput,
  planBlockDefinitions,
  validateBlockDefinitions,
} from "../block-definitions/service";
import { planCollectionDefinitions, validateCollectionDefinitions } from "../collections/service";
import { collectionDefinitionInput } from "../collections/validation";
import * as overlay from "../drafts/overlay";
import { drafts } from "../drafts/schema";
import { type Draft, draftOf } from "../drafts/scope";
import { requestGeneration } from "../generated-values/generation";
import { layoutDefinitionInput, planLayouts, targetLayouts } from "../layouts/service";
import { namingProject, projectRefOf } from "../projects/ref";
import { projects } from "../projects/schema";
import { homepageInput, planHomepage } from "../projects/service";

// --- Input Schemas ---
// Exported so adapters (oRPC, MCP, CLI) share the same canonical contract.
// Services .parse() them on entry — service is the trust boundary.

/**
 * A website's Definition Set: all its definitions taken together, with the content they declare.
 * It holds no schema hashes: the API computes them on write.
 */
export const definitionSetInput = z.object({
  blocks: z.array(blockDefinitionInput),
  layouts: z.array(layoutDefinitionInput),
  collections: z.array(collectionDefinitionInput),
  homepage: homepageInput.nullable(),
});

export const syncDefinitionsInput = namingProject(
  z.object({
    deployToken: z.string(),
    definitionSet: definitionSetInput,
  }),
);

// --- Writes ---

/**
 * Applies a Definition Set to Live, in one batch, for a release with the deploy token (ADR 0006).
 * The set either fully lands or changes nothing. Content never blocks it (ADR 0007).
 *
 * The sync reads Live's state once, validates the whole set, and plans every write from that
 * state: parts planned later take the definitions they depend on from the set, not from rows the
 * batch hasn't written yet.
 */
export const syncDefinitions = Effect.fn("definitions.syncDefinitions")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof syncDefinitionsInput>,
) {
  const input = yield* decodeInput(syncDefinitionsInput, rawInput);
  const target = yield* assertSyncAccess(ctx.db, projectRefOf(input), {
    draft: ctx.draft,
    deployToken: input.deployToken,
  });
  return yield* applyDefinitionSet(ctx, target, input.definitionSet);
});

/**
 * Syncs a revision's Definition Set into its draft, a draft with code: Camox's own sync target,
 * which no session or Deploy Token reaches. It follows a release's rules (ADR 0006): the whole set
 * is replaced, content never blocks it, and the content it declares is added as draft rows. In the
 * same batch, the revision becomes the draft's previewed revision, so the draft reads its own
 * definitions from its first synced revision on.
 */
export const syncRevisionDefinitions = Effect.fn("definitions.syncRevisionDefinitions")(function* (
  ctx: ServiceContext,
  {
    draftId,
    revisionId,
    definitionSet,
  }: {
    draftId: string;
    revisionId: string;
    definitionSet: unknown;
  },
) {
  const set = yield* decodeInput(definitionSetInput, definitionSet);
  const found = yield* Effect.promise(() =>
    ctx.db
      .select({ draft: drafts, project: projects })
      .from(drafts)
      .innerJoin(projects, eq(projects.id, drafts.projectId))
      .where(eq(drafts.id, draftId))
      .get(),
  );
  if (!found) return yield* new NotFoundError({ message: "The draft to sync ended" });
  const scope: Draft = { ...draftOf(found.draft), ownDefinitions: true };
  return yield* applyDefinitionSet(
    ctx,
    { project: found.project, scope, writes: scope },
    set,
    overlay.plannedStatements(
      ctx.db.update(drafts).set({ previewedRevisionId: revisionId }).where(eq(drafts.id, draftId)),
    ),
  );
});

/**
 * Every artifact source a Definition Set can put in content: in the blocks its layouts and
 * homepage declare, which it writes, in its definitions' default content, which new blocks
 * start from, and in its artifact fields' defaults, which reads show for content holding no
 * source. The sync stores them all, so content it writes or reads show never lacks a source.
 */
function declaredSources(set: z.output<typeof definitionSetInput>) {
  const schemaOf = new Map(set.blocks.map((block) => [block.blockId, block.contentSchema]));
  const sources = new Set<string>();
  const add = (found: Iterable<string>) => {
    for (const source of found) sources.add(source);
  };
  for (const block of [
    ...set.layouts.flatMap((layout) => layout.blocks),
    ...(set.homepage?.blocks ?? []),
  ]) {
    add(declaredArtifactSources(schemaOf.get(block.type), block.content, block.repeatableItems));
  }
  for (const block of set.blocks) {
    add(declaredArtifactSources(block.contentSchema, block.defaultContent));
    add(defaultArtifactSources(block.contentSchema));
  }
  return sources;
}

/**
 * Applies a Definition Set to a sync's target, with `alongside`'s writes in the same batch.
 */
const applyDefinitionSet = Effect.fn("definitions.applyDefinitionSet")(function* (
  ctx: ServiceContext,
  target: SyncTarget,
  set: z.output<typeof definitionSetInput>,
  alongside?: ReturnType<typeof overlay.plannedStatements>,
) {
  yield* validateBlockDefinitions(set.blocks);
  const collections = yield* validateCollectionDefinitions(set.collections);
  const collectionIds = new Set(collections.map((collection) => collection.collectionId));
  const now = Date.now();
  const plan = overlay.planner();

  const blocks = plan.add(yield* planBlockDefinitions(ctx, target, set.blocks, now));
  const collectionsResult = plan.add(yield* planCollectionDefinitions(ctx, target, collections));
  const synced = { definitions: blocks.definitions, collections: collectionIds };
  // ADR 0006 has a sync replace the target's whole definition set, but a set declaring no
  // layouts deliberately leaves the target's layouts (and their layout-only cleanup) as they
  // are: the SDK before definitions.sync skipped layouts.sync for an app without layouts.
  const declaresLayouts = set.layouts.length > 0;
  const layoutsResult = declaresLayouts
    ? plan.add(yield* planLayouts(ctx, target, set.layouts, synced, now))
    : null;
  const homepage = set.homepage
    ? plan.add(
        yield* planHomepage(ctx, target, set.homepage, {
          layouts: declaresLayouts ? set.layouts : yield* targetLayouts(ctx, target),
          ...synced,
        }),
      )
    : null;

  // Content stored under a definition whose schema changes may now hold artifact sources.
  const reshaped = new Map(
    [...blocks.reshaped].filter(([, contentSchema]) => hasArtifactFields(contentSchema)),
  );
  const heldSources = yield* Effect.promise(() =>
    contentArtifactSources(ctx.db, target.project.id, reshaped),
  );
  plan.add(
    overlay.plannedStatements(
      ...(yield* storingSources(ctx.db, target.project.id, [
        ...declaredSources(set),
        ...heldSources,
      ])),
    ),
  );
  if (alongside) plan.add(alongside);
  yield* overlay.runPlanned(ctx.db, plan.done(undefined));
  yield* recordDefinitionsSynced(ctx.db, target);
  for (const { home, target: generated, immediately } of homepage?.generation ?? []) {
    yield* requestGeneration(ctx.db, home, generated, { immediately });
  }

  return {
    blocks: {
      count: set.blocks.length,
      deletedDefinitionTypes: blocks.deletedDefinitionTypes,
    },
    collections: collectionsResult,
    layouts: layoutsResult && { count: set.layouts.length, ...layoutsResult },
    homepage: homepage?.homepage ?? null,
  };
});
