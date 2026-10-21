import { Effect } from "effect";
import { z } from "zod";

import { assertSyncAccess, recordDefinitionsSynced } from "../../authorization";
import { decodeInput } from "../../lib/errors";
import type { ServiceContext } from "../_shared/service-context";
import {
  blockDefinitionInput,
  planBlockDefinitions,
  validateBlockDefinitions,
} from "../block-definitions/service";
import { planCollectionDefinitions, validateCollectionDefinitions } from "../collections/service";
import { collectionDefinitionInput } from "../collections/validation";
import * as overlay from "../drafts/overlay";
import { requestGeneration } from "../generated-values/generation";
import { layoutDefinitionInput, planLayouts, targetLayouts } from "../layouts/service";
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

export const syncDefinitionsInput = z.object({
  projectSlug: z.string(),
  deployToken: z.string().optional(),
  autoCreate: z.boolean(),
  definitionSet: definitionSetInput,
});

// --- Writes ---

/**
 * Applies a Definition Set to the sync's target, in one batch: Live for a release with the deploy
 * token, or the caller's development draft for dev mode, which a sync allowed to `autoCreate`
 * creates first (ADR 0006). The set either fully lands or changes nothing, except for a
 * development draft just created, which stays empty. Content never blocks it (ADR 0007).
 *
 * The sync reads the target's state once, validates the whole set, and plans every write from
 * that state: parts planned later take the definitions they depend on from the set, not from
 * rows the batch hasn't written yet. Two syncs into one development draft at once both plan from
 * the same state, as they always could: one may then fail on rows the other wrote.
 */
export const syncDefinitions = Effect.fn("definitions.syncDefinitions")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof syncDefinitionsInput>,
) {
  const input = yield* decodeInput(syncDefinitionsInput, rawInput);
  const { definitionSet: set } = input;
  // Outside the batch: a sync that fails later leaves the development draft it created, empty.
  const target = yield* assertSyncAccess(
    ctx.db,
    input.projectSlug,
    { user: ctx.user, draft: ctx.draft, deployToken: input.deployToken },
    { create: input.autoCreate },
  );
  yield* validateBlockDefinitions(set.blocks);
  const collections = yield* validateCollectionDefinitions(set.collections);
  const collectionIds = new Set(collections.map((collection) => collection.collectionId));
  const now = Date.now();
  const plan = overlay.planner();

  const blocks = plan.add(yield* planBlockDefinitions(ctx, target, set.blocks, now));
  const collectionsResult = plan.add(yield* planCollectionDefinitions(ctx, target, collections));
  const synced = { definitions: blocks.definitions, collections: collectionIds };
  // ADR 0006 has dev mode replace the draft's whole definition set, but a set declaring no
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

  yield* overlay.runPlanned(ctx.db, plan.done(undefined));
  yield* recordDefinitionsSynced(ctx.db, target);
  for (const { home, target: generated, immediately } of homepage?.generation ?? []) {
    yield* requestGeneration(ctx.db, home, generated, { immediately });
  }

  return {
    draftCreated: target.draftCreated,
    blocks: {
      count: set.blocks.length,
      deletedDefinitionTypes: blocks.deletedDefinitionTypes,
    },
    collections: collectionsResult,
    layouts: layoutsResult && { count: set.layouts.length, ...layoutsResult },
    homepage: homepage?.homepage ?? null,
  };
});
