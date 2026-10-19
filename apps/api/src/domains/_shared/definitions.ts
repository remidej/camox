import { eq, isNull, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import { draftIn, type ReadScope } from "../drafts/scope";

// Definitions live in Live and in development drafts (ADR 0006). Live holds the released
// definitions; each development draft holds the complete set synced from its owner's local code.
// Regular drafts have none of their own and read Live's. Every reader of block definitions,
// layouts and collection definitions picks its set here.

/** The draft whose definitions a scope reads: its own for a development draft, else Live's. */
export function definitionsDraftOf(scope: ReadScope): string | null {
  const draft = draftIn(scope);
  return draft?.kind === "development" ? draft.id : null;
}

/** The definitions a scope reads in a definition table, as a condition on that table. */
export function definitionsIn(table: { draftId: AnySQLiteColumn }, scope: ReadScope): SQL {
  const draftId = definitionsDraftOf(scope);
  return draftId === null ? isNull(table.draftId) : eq(table.draftId, draftId);
}
