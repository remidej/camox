import { artifactSourceHash } from "@camox/api-contract";
import { Effect } from "effect";

import type { Database } from "../../db";
import { isObject } from "../../lib/is-object";
import { fieldsOf, seedSchemas, type ItemSeed } from "../_shared/fields";
import type { BatchItem } from "../drafts/overlay";
import { artifactSources } from "./schema";

/**
 * The artifact sources a block's or an item's own content holds, by field name: the artifact
 * fields of `schema` (not those of its repeaters' items, which are rows of their own) whose value
 * is a non-empty string. An empty artifact shows nothing, so it has no source to store or load.
 */
export function artifactSourcesOf(schema: unknown, content: unknown): Map<string, string> {
  const sources = new Map<string, string>();
  if (!isObject(content)) return sources;
  for (const field of fieldsOf(schema)) {
    if (field.kind !== "Artifact") continue;
    const value = content[field.name];
    if (typeof value === "string" && value.trim() !== "") sources.set(field.name, value);
  }
  return sources;
}

/**
 * Visits `schema` with `content`, then each of its repeaters' item schemas, at any depth, with
 * each inline item the content holds there. Without content, it visits each item schema once,
 * with no content.
 */
function eachNested(
  schema: unknown,
  content: unknown,
  visit: (schema: unknown, content: unknown) => void,
) {
  visit(schema, content);
  for (const field of fieldsOf(schema)) {
    if (field.kind !== "Repeater") continue;
    const items =
      content === undefined ? [undefined] : isObject(content) ? content[field.name] : undefined;
    if (!Array.isArray(items)) continue;
    for (const item of items) eachNested(field.itemContentSchema, item, visit);
  }
}

/**
 * Every artifact source content declared under `schema` holds, as a definition sync or a seed
 * declares it before it's split into rows: in the content itself, in its repeaters' inline items
 * at any depth, and in item `seeds`.
 */
export function declaredArtifactSources(
  schema: unknown,
  content: unknown,
  seeds: readonly ItemSeed[] = [],
): Set<string> {
  const sources = new Set<string>();
  const add = (schema: unknown, content: unknown) => {
    for (const source of artifactSourcesOf(schema, content).values()) sources.add(source);
  };
  eachNested(schema, content ?? null, add);
  const schemas = seedSchemas(schema, seeds);
  for (const seed of seeds) {
    eachNested(schemas.get(seed.tempId)?.content, seed.content ?? null, add);
  }
  return sources;
}

/**
 * The non-empty default sources of the artifact fields of `schema` and of its repeaters' items,
 * at any depth, which reads show for content holding no source of its own.
 */
export function defaultArtifactSources(schema: unknown): Set<string> {
  const sources = new Set<string>();
  eachNested(schema, undefined, (schema) => {
    for (const field of fieldsOf(schema)) {
      const fallback = field.kind === "Artifact" ? field.schema.default : undefined;
      if (typeof fallback === "string" && fallback.trim() !== "") sources.add(fallback);
    }
  });
  return sources;
}

/** Whether `schema`, or any of its repeaters' item schemas at any depth, has an artifact field. */
export function hasArtifactFields(schema: unknown): boolean {
  let found = false;
  eachNested(schema, undefined, (schema) => {
    found ||= fieldsOf(schema).some((field) => field.kind === "Artifact");
  });
  return found;
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
 * The statements storing `sources` for a project, to run in the batch of the write whose content
 * holds them, so content never holds a source the store lacks. Storing a source again does
 * nothing: a hash names one source for good. Content writes store theirs through the overlay
 * (`overlay.ArtifactSourcesOf`).
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
