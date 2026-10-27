import { artifactSourceHash } from "@camox/api-contract";
import { and, eq, inArray, or } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import { itemSchemas } from "../_shared/fields";
import { blockDefinitions } from "../block-definitions/schema";
import { blocks, sharedContents } from "../blocks/schema";
import { repeatableItems } from "../repeatable-items/schema";
import { artifactSources } from "./schema";
import { artifactSourcesOf, declaredArtifactSources, defaultArtifactSources } from "./store";

// Finds the artifact sources content holds in rows of every scope, Live and every draft, read
// through their definitions' schemas: for the one-off migration (#640), which stores every source
// content held before the store existed, and for definition syncs, whose schema changes can turn
// what content holds into artifact sources. It reads through Drizzle only, so the migration runs
// against the Worker's D1 binding in tests, and against production's D1 through its HTTP API
// (`scripts/backfill-artifact-sources.ts`).

/** A database whose queries are awaited: D1, or a proxy to it. */
type AsyncDatabase = BaseSQLiteDatabase<"async", unknown, Record<string, unknown>>;

type ItemRow = typeof repeatableItems.$inferSelect;

/** Content rows, in any scope: blocks, shared contents, and the items under them. */
type ContentRows = {
  blocks: (typeof blocks.$inferSelect)[];
  sharedContents: (typeof sharedContents.$inferSelect)[];
  items: ItemRow[];
};

/** Artifact sources, by project. */
type SourcesByProject = Map<number, Set<string>>;

const add = (found: SourcesByProject, projectId: number, sources: Iterable<string>) => {
  const into = found.get(projectId) ?? new Set();
  for (const source of sources) into.add(source);
  found.set(projectId, into);
};

/**
 * The artifact sources `rows` hold, each read through every content schema `schemasOf` gives its
 * definition. Items are read through their tree's root, skipping those whose root isn't in `rows`.
 */
function sourcesOfRows(
  rows: ContentRows,
  schemasOf: (projectId: number, type: string) => readonly unknown[],
  found: SourcesByProject = new Map(),
) {
  for (const row of [...rows.blocks, ...rows.sharedContents]) {
    for (const schema of schemasOf(row.projectId, row.type)) {
      add(found, row.projectId, artifactSourcesOf(schema, row.content).values());
    }
  }

  // Items by the root of their tree, whose definition's schemas find each item's own.
  const typeOfBlock = new Map(
    rows.blocks.map((row) => [row.id, { projectId: row.projectId, type: row.type }]),
  );
  const trees = new Map<string, { projectId: number; type: string; items: ItemRow[] }>();
  for (const item of rows.items) {
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
    for (const schema of schemasOf(tree.projectId, tree.type)) {
      const ofItem = itemSchemas(schema, tree.items);
      for (const item of tree.items) {
        add(
          found,
          tree.projectId,
          artifactSourcesOf(ofItem.get(item.id)?.content, item.content).values(),
        );
      }
    }
  }
  return found;
}

// D1 binds at most 100 parameters per statement.
const TYPES_PER_QUERY = 50;

/**
 * The artifact sources a project's content of the given definitions holds, in Live and in every
 * draft, read through each definition's content schema in `schemas`, by type.
 */
export async function contentArtifactSources(
  db: AsyncDatabase,
  projectId: number,
  schemas: ReadonlyMap<string, unknown>,
): Promise<Set<string>> {
  const found: SourcesByProject = new Map();
  const types = [...schemas.keys()];
  for (let start = 0; start < types.length; start += TYPES_PER_QUERY) {
    const chunk = types.slice(start, start + TYPES_PER_QUERY);
    const ofTypes = <T extends typeof blocks | typeof sharedContents>(table: T) =>
      and(eq(table.projectId, projectId), inArray(table.type, chunk));
    const blockRows = await db.select().from(blocks).where(ofTypes(blocks));
    const sharedRows = await db.select().from(sharedContents).where(ofTypes(sharedContents));
    const items = await db
      .select()
      .from(repeatableItems)
      .where(
        or(
          inArray(
            repeatableItems.blockId,
            db.select({ id: blocks.id }).from(blocks).where(ofTypes(blocks)),
          ),
          and(
            eq(repeatableItems.projectId, projectId),
            inArray(repeatableItems.sharedContentType, chunk),
          ),
        ),
      );
    sourcesOfRows(
      { blocks: blockRows, sharedContents: sharedRows, items },
      (_, type) => (schemas.has(type) ? [schemas.get(type)] : []),
      found,
    );
  }
  return found.get(projectId) ?? new Set();
}

const definitionKey = (projectId: number | null, type: string | null) => `${projectId}:${type}`;

/** Stores every artifact source the database's content holds. Returns how many it found. */
export async function backfillArtifactSources(db: AsyncDatabase) {
  const found: SourcesByProject = new Map();

  // Every schema a definition had, in Live and in any draft: content is read through each.
  const schemas = new Map<string, unknown[]>();
  for (const definition of await db.select().from(blockDefinitions)) {
    const key = definitionKey(definition.projectId, definition.blockId);
    schemas.set(key, [...(schemas.get(key) ?? []), definition.contentSchema]);
    add(found, definition.projectId, defaultArtifactSources(definition.contentSchema));
    add(
      found,
      definition.projectId,
      declaredArtifactSources(definition.contentSchema, definition.defaultContent),
    );
  }

  sourcesOfRows(
    {
      blocks: await db.select().from(blocks),
      sharedContents: await db.select().from(sharedContents),
      items: await db.select().from(repeatableItems),
    },
    (projectId, type) => schemas.get(definitionKey(projectId, type)) ?? [],
    found,
  );

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
