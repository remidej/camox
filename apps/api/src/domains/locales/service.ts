import type { Database } from "../../db";
import { INITIAL_LOCALE, locales } from "./schema";

/**
 * Gives a new project its default locale on Live, as the migration gave existing projects. No
 * member published it, so it never counts as Live's latest publish.
 */
export function insertInitialLocale(db: Database, projectId: number, now: number) {
  return db.insert(locales).values({
    projectId,
    tag: INITIAL_LOCALE,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });
}
