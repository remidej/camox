import type { SQL } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import * as overlay from "../drafts/overlay";
import type { ReadScope } from "../drafts/scope";

// D1 binds at most 100 parameters per statement, so reads naming many ids split them.
const CHUNK = 90;

/**
 * The rows a scope reads matching `where` for each chunk of `values`: one query per chunk of
 * `size` values, none for no values. `size` leaves room for the parameters each value binds.
 */
export const selectInChunks = <T extends overlay.ContentTable, V>(
  db: Database,
  scope: ReadScope,
  table: T,
  values: readonly V[],
  where: (chunk: V[]) => SQL | undefined,
  size = CHUNK,
) =>
  Effect.gen(function* () {
    const rows: T["$inferSelect"][] = [];
    for (let start = 0; start < values.length; start += size) {
      const chunk = values.slice(start, start + size);
      rows.push(...(yield* overlay.select(db, scope, table, where(chunk))));
    }
    return rows;
  });
