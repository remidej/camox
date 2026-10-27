import { artifactSourceHash } from "@camox/api-contract";
import { Effect } from "effect";

import type { Database } from "../../db";
import { fieldsOf, itemSchemas } from "../_shared/fields";
import type { BatchItem } from "../drafts/overlay";
import { artifactSources } from "./schema";

/**
 * The artifact sources a block's or an item's own content holds, by field name: the artifact
 * fields of `schema` (not those of its repeaters' items, which are rows of their own) whose value
 * is a non-empty string. An empty artifact shows nothing, so it has no source to store or load.
 */
export function artifactSourcesOf(schema: unknown, content: unknown): Map<string, string> {
  const sources = new Map<string, string>();
  if (!content || typeof content !== "object" || Array.isArray(content)) return sources;
  const values = content as Record<string, unknown>;
  for (const field of fieldsOf(schema)) {
    if (field.kind !== "Artifact") continue;
    const value = values[field.name];
    if (typeof value === "string" && value.trim() !== "") sources.set(field.name, value);
  }
  return sources;
}

/** An item seed: content beneath a parent seed (or the root) by temporary ids. */
type Seed = { tempId: string; parentTempId: string | null; fieldName: string; content: unknown };

/**
 * Every artifact source content declared under `schema` holds, as a definition sync or a seed
 * declares it before it's split into rows: in the content itself, in its repeaters' inline items
 * at any depth, and in item `seeds`.
 */
export function declaredArtifactSources(
  schema: unknown,
  content: unknown,
  seeds: readonly Seed[] = [],
): Set<string> {
  const sources = new Set<string>();
  const walk = (schema: unknown, content: unknown) => {
    for (const source of artifactSourcesOf(schema, content).values()) sources.add(source);
    if (!content || typeof content !== "object") return;
    for (const field of fieldsOf(schema)) {
      const items = (content as Record<string, unknown>)[field.name];
      if (field.kind !== "Repeater" || !Array.isArray(items)) continue;
      for (const item of items) walk(field.itemContentSchema, item);
    }
  };
  walk(schema, content);
  const schemas = itemSchemas(
    schema,
    seeds.map((seed) => ({
      id: seed.tempId,
      parentItemId: seed.parentTempId,
      fieldName: seed.fieldName,
    })),
  );
  for (const seed of seeds) walk(schemas.get(seed.tempId)?.content, seed.content);
  return sources;
}

/**
 * The non-empty default sources of the artifact fields of `schema` and of its repeaters' items,
 * at any depth, which reads show for content holding no source of its own.
 */
export function defaultArtifactSources(schema: unknown): Set<string> {
  const sources = new Set<string>();
  const walk = (schema: unknown) => {
    for (const field of fieldsOf(schema)) {
      if (field.kind === "Repeater") walk(field.itemContentSchema);
      const fallback = field.kind === "Artifact" ? field.schema.default : undefined;
      if (typeof fallback === "string" && fallback.trim() !== "") sources.add(fallback);
    }
  };
  walk(schema);
  return sources;
}

/**
 * The hash of each artifact source a block's or an item's own content holds, by field name, as
 * reads return them alongside the content. Hashes what the content holds, including schema
 * defaults conformed in at read time.
 */
export const artifactHashesOf = Effect.fn("artifactSources.hashesOf")(function* (
  schema: unknown,
  content: unknown,
) {
  const sources = [...artifactSourcesOf(schema, content)];
  if (sources.length === 0) return {};
  const hashes = yield* Effect.promise(() =>
    Promise.all(sources.map(([, source]) => artifactSourceHash(source))),
  );
  return Object.fromEntries(sources.map(([name], index) => [name, hashes[index]!]));
});

/**
 * The statements storing the artifact sources a write of `content` sets, to run in the same batch
 * as the write, so content never holds a source the store lacks. Storing a source again does
 * nothing: a hash names one source for good.
 */
export const storingArtifactSources = Effect.fn("artifactSources.storing")(function* (
  db: Database,
  projectId: number,
  schema: unknown,
  content: unknown,
) {
  return yield* storingSources(db, projectId, artifactSourcesOf(schema, content).values());
});

/**
 * The statements storing `sources` for a project, to run in the batch of the write whose content
 * holds them. Storing a source again does nothing.
 */
export const storingSources = Effect.fn("artifactSources.storingSources")(function* (
  db: Database,
  projectId: number,
  found: Iterable<string>,
) {
  const sources = [...new Set(found)];
  if (sources.length === 0) return [] as BatchItem[];
  const hashes = yield* Effect.promise(() => Promise.all(sources.map(artifactSourceHash)));
  const createdAt = Date.now();
  // One statement per source: D1 binds at most 100 parameters per statement.
  return sources.map((source, index): BatchItem =>
    db
      .insert(artifactSources)
      .values({ projectId, hash: hashes[index]!, source, createdAt })
      .onConflictDoNothing(),
  );
});
