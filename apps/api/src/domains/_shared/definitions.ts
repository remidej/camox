import { eq, isNull, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import { drafts } from "../drafts/schema";
import { draftIn, type ReadScope } from "../drafts/scope";

// Definitions live in Live, in development drafts and in drafts with code (ADR 0006). Live holds
// the released definitions; each development draft holds the complete set synced from its owner's
// local code; a draft with code holds the set of its previewed revision, from its first one on.
// Other drafts have none of their own and read Live's. Every reader of block definitions, layouts
// and collection definitions picks its set here.

/**
 * The draft whose definitions a sync of `scope` writes: its own for a development draft or a
 * revision's sync (`ownDefinitions`), else Live's. Readers go through `definitionsIn`, which also
 * knows when a draft with code reads its own.
 */
export function definitionsDraftOf(scope: ReadScope): string | null {
  const draft = draftIn(scope);
  return draft?.kind === "development" || draft?.ownDefinitions ? draft.id : null;
}

/** The definitions a scope reads in a definition table, as a condition on that table. */
export function definitionsIn(table: { draftId: AnySQLiteColumn }, scope: ReadScope): SQL {
  const draft = draftIn(scope);
  if (!draft) return isNull(table.draftId);
  if (definitionsDraftOf(draft) !== null) return eq(table.draftId, draft.id);
  // A regular draft reads its own once a revision of its code synced them. It's decided in the
  // read's own statement, so no read sees the switch half done.
  return sql`case when exists (select 1 from ${drafts} where ${drafts.id} = ${draft.id} and ${drafts.previewedRevisionId} is not null) then ${table.draftId} = ${draft.id} else ${table.draftId} is null end`;
}
