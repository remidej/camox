import { eq, isNull, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import type { DraftScope } from "../drafts/scope";

// Definitions live in Live and in development drafts (ADR 0006). Live holds the released
// definitions; each development draft holds the complete set synced from its owner's local code.
// Regular drafts have none of their own and read Live's. Every reader of block definitions,
// layouts and collection definitions picks its set here.

/** The draft whose definitions a scope reads: its own for a development draft, else Live's. */
export function definitionsDraftOf(scope: DraftScope): string | null {
  return scope?.kind === "development" ? scope.id : null;
}

/** The definitions a scope reads in a definition table, as a condition on that table. */
export function definitionsIn(table: { draftId: AnySQLiteColumn }, scope: DraftScope): SQL {
  const draftId = definitionsDraftOf(scope);
  return draftId === null ? isNull(table.draftId) : eq(table.draftId, draftId);
}
