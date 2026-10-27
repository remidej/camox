import { artifactSourceHash } from "@camox/api-contract";
import { Effect } from "effect";

import type { Database } from "../../db";
import { fieldsOf } from "../_shared/fields";
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
  const sources = [...new Set(artifactSourcesOf(schema, content).values())];
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
