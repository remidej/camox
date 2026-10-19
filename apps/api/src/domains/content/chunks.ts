import type { SQL } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import * as overlay from "../drafts/overlay";
import type { ReadScope } from "../drafts/scope";

// D1 binds at most 100 parameters per statement, so reads naming many ids split them.
const CHUNK = 90;

/**
 * What `read` returns for each chunk of `values`, in one list: one read per chunk of `size`
 * values, none for no values. `size` leaves room for the parameters each value binds.
 */
export const readInChunks = <V, R, E, Q>(
  values: readonly V[],
  read: (chunk: V[]) => Effect.Effect<readonly R[], E, Q>,
  size = CHUNK,
) =>
  Effect.gen(function* () {
    const rows: R[] = [];
    for (let start = 0; start < values.length; start += size) {
      rows.push(...(yield* read(values.slice(start, start + size))));
    }
    return rows;
  });

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
