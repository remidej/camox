import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";

import {
  account,
  invitation,
  member,
  organizationTable,
  session,
  user,
  verification,
  blockDefinitions,
  collectionDefinitions,
  collectionRecords,
  blocks,
  drafts,
  files,
  generatedValues,
  layouts,
  pages,
  projects,
  repeatableItems,
} from "./schema";

const schema = {
  projects,
  drafts,
  pages,
  layouts,
  blocks,
  repeatableItems,
  files,
  generatedValues,
  blockDefinitions,
  collectionDefinitions,
  collectionRecords,
  user,
  session,
  account,
  verification,
  organization: organizationTable,
  member,
  invitation,
};

// Annotated: for the inferred type, TypeScript 7's declaration emit names drizzle's `TClient`
// instead of D1Database.
export function createDb(
  d1: D1Database,
): DrizzleD1Database<typeof schema> & { $client: D1Database } {
  return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof createDb>;
