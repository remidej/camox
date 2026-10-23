import type { SQL } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import * as overlay from "../drafts/overlay";
import type { ReadScope } from "../drafts/scope";

// D1 binds at most 100 parameters per statement, so reads naming many ids split them.
const CHUNK = 90;
// How many chunks of one read are in flight at once.
const CONCURRENT_CHUNKS = 6;

/**
 * What `read` returns for each chunk of `values`, in one list: one read per chunk of `size`
 * values, none for no values, several at once. `size` leaves room for the parameters each value
 * binds.
 */
export const readInChunks = <V, R, E, Q>(
  values: readonly V[],
  read: (chunk: V[]) => Effect.Effect<readonly R[], E, Q>,
  size = CHUNK,
) => {
  const chunks: V[][] = [];
  for (let start = 0; start < values.length; start += size) {
    chunks.push(values.slice(start, start + size));
  }
  return Effect.map(Effect.forEach(chunks, read, { concurrency: CONCURRENT_CHUNKS }), (rows) =>
    rows.flat(),
  );
};

/** The rows a scope reads matching `where` for each chunk of `values`, as `readInChunks` reads. */
export const selectInChunks = <T extends overlay.ContentTable, V>(
  db: Database,
  scope: ReadScope,
  table: T,
  values: readonly V[],
  where: (chunk: V[]) => SQL | undefined,
  size = CHUNK,
) =>
  readInChunks(
    values,
    (chunk): Effect.Effect<T["$inferSelect"][]> => overlay.select(db, scope, table, where(chunk)),
    size,
  );
