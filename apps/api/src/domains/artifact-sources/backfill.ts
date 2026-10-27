import { artifactSourceHash } from "@camox/api-contract";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import { itemSchemas } from "../_shared/fields";
import { blockDefinitions } from "../block-definitions/schema";
import { blocks, sharedContents } from "../blocks/schema";
import { repeatableItems } from "../repeatable-items/schema";
import { artifactSources } from "./schema";
import { artifactSourcesOf, declaredArtifactSources, defaultArtifactSources } from "./store";

// A one-off migration (#640): it stores every artifact source content held before the store
// existed, in Live and in every draft, and the default sources reads fill in, so every artifact
// URL a website names has a document. Storing a source again does nothing, so it can run again.
// It reads and writes through Drizzle only, so it runs against the Worker's D1 binding in tests,
// and against production's D1 through its HTTP API (`scripts/backfill-artifact-sources.ts`).

/** A database whose queries are awaited: D1, or a proxy to it. */
type AsyncDatabase = BaseSQLiteDatabase<"async", unknown, Record<string, unknown>>;

const definitionKey = (projectId: number | null, type: string | null) => `${projectId}:${type}`;

/** Stores every artifact source the database's content holds. Returns how many it found. */
export async function backfillArtifactSources(db: AsyncDatabase) {
  const found = new Map<number, Set<string>>();
  const add = (projectId: number, sources: Iterable<string>) => {
    const into = found.get(projectId) ?? new Set();
    for (const source of sources) into.add(source);
    found.set(projectId, into);
  };

  // Every schema a definition had, in Live and in any draft: content is read through each.
  const schemas = new Map<string, unknown[]>();
  for (const definition of await db.select().from(blockDefinitions)) {
    const key = definitionKey(definition.projectId, definition.blockId);
    schemas.set(key, [...(schemas.get(key) ?? []), definition.contentSchema]);
    add(definition.projectId, defaultArtifactSources(definition.contentSchema));
    add(
      definition.projectId,
      declaredArtifactSources(definition.contentSchema, definition.defaultContent),
    );
  }
  const schemasOf = (key: string) => schemas.get(key) ?? [];

  const blockRows = await db.select().from(blocks);
  const typeOfBlock = new Map(
    blockRows.map((row) => [row.id, { projectId: row.projectId, type: row.type }]),
  );
  for (const row of [...blockRows, ...(await db.select().from(sharedContents))]) {
    for (const schema of schemasOf(definitionKey(row.projectId, row.type))) {
      add(row.projectId, artifactSourcesOf(schema, row.content).values());
    }
  }

  // Items by the root of their tree, whose definition's schemas find each item's own.
  const trees = new Map<string, { projectId: number; type: string; items: ItemRow[] }>();
  for (const item of await db.select().from(repeatableItems)) {
    const root =
      item.sharedContentType !== null && item.projectId !== null
        ? { projectId: item.projectId, type: item.sharedContentType }
        : typeOfBlock.get(item.blockId ?? "");
    if (!root) continue;
    const key = item.sharedContentType !== null ? `shared:${root.type}` : `block:${item.blockId}`;
    const treeKey = `${root.projectId}:${key}`;
    const tree = trees.get(treeKey) ?? { ...root, items: [] };
    tree.items.push(item);
    trees.set(treeKey, tree);
  }
  for (const tree of trees.values()) {
    for (const schema of schemasOf(definitionKey(tree.projectId, tree.type))) {
      const ofItem = itemSchemas(schema, tree.items);
      for (const item of tree.items) {
        add(tree.projectId, artifactSourcesOf(ofItem.get(item.id)?.content, item.content).values());
      }
    }
  }

  let count = 0;
  const createdAt = Date.now();
  for (const [projectId, sources] of found) {
    for (const source of sources) {
      const hash = await artifactSourceHash(source);
      await db
        .insert(artifactSources)
        .values({ projectId, hash, source, createdAt })
        .onConflictDoNothing();
      count++;
    }
  }
  return count;
}

type ItemRow = typeof repeatableItems.$inferSelect;
