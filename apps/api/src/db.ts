import { drizzle } from "drizzle-orm/d1";

import {
  aiJobs,
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
  collectionRevisions,
  blocks,
  environments,
  files,
  layoutCheckpoints,
  layouts,
  pageCheckpoints,
  pages,
  projects,
  repeatableItems,
} from "./schema";

const schema = {
  projects,
  environments,
  pages,
  pageCheckpoints,
  layouts,
  layoutCheckpoints,
  blocks,
  repeatableItems,
  files,
  aiJobs,
  blockDefinitions,
  collectionDefinitions,
  collectionRecords,
  collectionRevisions,
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
