import { drizzle } from "drizzle-orm/d1";

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

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof createDb>;
