import { Effect } from "effect";

import type { Database } from "../../db";
import { seedSchemas, type ItemSeed } from "../_shared/fields";
import * as overlay from "../drafts/overlay";
import type { Draft } from "../drafts/scope";
import { rootColumns, type ItemRoot } from "./roots";
import { repeatableItems } from "./schema";

/**
 * Creates repeatable item seeds in a draft's tree under `root`, parents before children, each
 * storing the artifact sources it holds. Seeds naming no parent seed go under `parent`: the item
 * whose content schema is `schema`, or the root itself when `parent` is null.
 */
export const insertItemSeeds = Effect.fn("repeatableItems.insertSeeds")(function* (
  db: Database,
  scope: Draft,
  {
    root,
    parent,
    schema,
    seeds,
    now,
  }: {
    root: ItemRoot;
    parent: string | null;
    schema: unknown;
    seeds: readonly ItemSeed[];
    now: number;
  },
) {
  const schemas = seedSchemas(schema, seeds);
  const ids = new Map<string, string>();
  for (const seed of seeds) {
    // A fresh id, so the scope can't already hold the item.
    const inserted = (yield* overlay.insert(
      db,
      scope,
      repeatableItems,
      {
        ...rootColumns(root),
        parentItemId: seed.parentTempId ? (ids.get(seed.parentTempId) ?? parent) : parent,
        fieldName: seed.fieldName,
        content: seed.content,
        settings: seed.settings,
        position: seed.position,
        createdAt: now,
        updatedAt: now,
      },
      { artifactSources: { schema: schemas.get(seed.tempId)?.content } },
    ))!;
    ids.set(seed.tempId, inserted.id);
  }
});
