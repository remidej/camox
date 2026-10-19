import { sql } from "drizzle-orm";
import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { drafts } from "../drafts/schema";
import { INITIAL_LOCALE } from "../locales/schema";
import { projects } from "../projects/schema";

/** What a generated value describes, named like the draft overlay's entities. */
export type GeneratedEntity = "block" | "sharedContent" | "repeatableItem" | "page" | "file";

/**
 * The values AI derives from content (ADR 0012). A file's filename is shared by every locale and
 * generated in the default locale only: other locales' file metadata is its alt text alone.
 */
export type GeneratedValues = {
  summary: { summary: string };
  seo: { metaTitle: string; metaDescription: string };
  fileMetadata: { alt: string; filename?: string };
};

export type GeneratedType = keyof GeneratedValues;

/**
 * Generated values sit beside content (ADR 0012): one per entity, type, locale, and Live or
 * draft. Summaries are generated in the default locale only; SEO and alt text in every locale. A
 * Live row has no draft; a draft row is a value the draft generated itself, which it reads over
 * Live's. Writing one never copies an entity into a draft, never counts as a change and never
 * conflicts. Publishing copies a draft's values over Live's.
 */
export const generatedValues = sqliteTable(
  "generated_values",
  {
    rowId: int("row_id").primaryKey(),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    entity: text().notNull().$type<GeneratedEntity>(),
    entityId: text("entity_id").notNull(),
    type: text().notNull().$type<GeneratedType>(),
    // The tag of the locale the value is in, like content's (ADR 0015).
    locale: text().notNull().default(INITIAL_LOCALE),
    // Null until a job generated it.
    value: text({ mode: "json" }).$type<GeneratedValues[GeneratedType]>(),
    // When a job was last requested and hasn't finished since: generation is pending.
    requestedAt: int("requested_at"),
    generatedAt: int("generated_at"),
  },
  (table) => [
    uniqueIndex("generated_values_live_idx")
      .on(table.entity, table.entityId, table.type, table.locale)
      .where(sql`${table.draftId} is null`),
    uniqueIndex("generated_values_draft_idx")
      .on(table.draftId, table.entity, table.entityId, table.type, table.locale)
      .where(sql`${table.draftId} is not null`),
    index("generated_values_project_idx").on(table.projectId),
  ],
);
