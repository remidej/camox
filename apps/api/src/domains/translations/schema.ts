import { sql } from "drizzle-orm";
import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import type { TranslatedEntity } from "../../lib/ai-job-queue";
import { drafts } from "../drafts/schema";
import { projects } from "../projects/schema";
import type { Values } from "./bookkeeping";

/** What a translation job translates, as its request stores it. */
export type TranslationRequestSource = "defaultLocale" | "defaults" | "live";

/**
 * A pending translation job (ADR 0015): one per entity, locale, draft and source, from when the
 * job is requested until a job of that key finishes. A draft's pending translations are what it
 * shows as translating. A job whose row is gone does nothing: its draft ended, emptied or dropped
 * the locale since. Not content: writing it never counts as a change.
 */
export const translationRequests = sqliteTable(
  "translation_requests",
  {
    rowId: int("row_id").primaryKey(),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    entity: text().notNull().$type<TranslatedEntity>(),
    entityId: text("entity_id").notNull(),
    // The tag of the locale to translate into.
    locale: text().notNull(),
    // What the job translates: the entity in the default locale, the code-owned defaults it
    // was placed with in the locale, or the entity in the default locale merged with Live's
    // localization (`live`, ADR 0016). Each settles apart.
    source: text().notNull().default("defaultLocale").$type<TranslationRequestSource>(),
    // When a job of this key was last requested.
    requestedAt: int("requested_at").notNull(),
  },
  (table) => [
    uniqueIndex("translation_requests_key_idx").on(
      table.draftId,
      table.entity,
      table.entityId,
      table.locale,
      table.source,
    ),
    index("translation_requests_project_idx").on(table.projectId),
  ],
);

/**
 * A value a translation job gave an entity that must be unique within a locale of a draft, such
 * as a page's full path or a record page's slug, named with the space it's unique in. Jobs run
 * concurrently: the unique index lets one job claim a value, so another job translating to the
 * same value picks the next one. A claim holds only while its entity has a pending translation:
 * after that, what the job wrote is what keeps the value taken. Claims are dropped when their
 * entity gets another value, and with the draft's pending translations. Not content.
 */
export const translationClaims = sqliteTable(
  "translation_claims",
  {
    rowId: int("row_id").primaryKey(),
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    locale: text().notNull(),
    // What the value is unique among: `page` for full paths, or a record page's collection and
    // field.
    space: text().notNull(),
    value: text().notNull(),
    entityId: text("entity_id").notNull(),
  },
  (table) => [
    uniqueIndex("translation_claims_value_idx").on(
      table.draftId,
      table.locale,
      table.space,
      table.value,
    ),
    index("translation_claims_entity_idx").on(table.draftId, table.entityId),
  ],
);

/**
 * A localization's bookkeeping: the source it was last translated from and what Camox wrote
 * from it, for the entity as a whole, each as the localization's columns with its content and
 * settings. A translation job merges three ways from it: what the source changed since,
 * against what someone changed in the localization since. Like generated values (ADR 0012) it
 * sits beside content, one per entity and locale for Live and for each draft whose jobs wrote
 * their own, which the draft reads over Live's. Writing it never copies an entity into a draft,
 * never counts as a change and never conflicts. Publishing copies a draft's over Live's. Content
 * that exists in one locale only has none.
 */
export const translationBookkeeping = sqliteTable(
  "translation_bookkeeping",
  {
    rowId: int("row_id").primaryKey(),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    entity: text().notNull().$type<TranslatedEntity>(),
    entityId: text("entity_id").notNull(),
    // The tag of the localization's locale.
    locale: text().notNull(),
    source: text({ mode: "json" }).notNull().$type<Values>(),
    output: text({ mode: "json" }).notNull().$type<Values>(),
  },
  (table) => [
    uniqueIndex("translation_bookkeeping_live_idx")
      .on(table.entity, table.entityId, table.locale)
      .where(sql`${table.draftId} is null`),
    uniqueIndex("translation_bookkeeping_draft_idx")
      .on(table.draftId, table.entity, table.entityId, table.locale)
      .where(sql`${table.draftId} is not null`),
    index("translation_bookkeeping_project_idx").on(table.projectId),
  ],
);

/**
 * An exclusion: a localization deleted from its locale (ADR 0015), which translation jobs don't
 * bring back, nor anything beneath it, however its original changes. It is keyed by the excluded
 * entity's own id and its locale, so drafts excluding the same localization exclude it once.
 * Exclusions are content: Live and every draft store them side by side (ADR 0005), so a draft's
 * exclusions are changes in their locale, and publishing copies them to Live, where they stay,
 * the exception to ADR 0008 that ADR 0015 records. Adding a localization back deletes its
 * exclusion. Read and write exclusions through the draft overlay.
 */
export const localizationExclusions = sqliteTable(
  "localization_exclusions",
  {
    rowId: int("row_id").primaryKey(),
    // The excluded entity's id.
    id: text().notNull(),
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    // Live: the number of changes made to the row. Unused on draft rows (last write wins).
    version: int().notNull().default(1),
    // The Live version a draft copy started from. Null on Live rows and on exclusions a draft
    // recorded.
    baseVersion: int("base_version"),
    // A draft's deletion of the exclusion: the localization is added back.
    deleted: int({ mode: "boolean" }).notNull().default(false),
    firstPublishedAt: int("first_published_at"),
    publishedAt: int("published_at"),
    publishedBy: text("published_by"),
    // The tag of the locale the entity is excluded from, never the default locale's.
    locale: text().notNull(),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // The kind of the excluded entity.
    entity: text().notNull().$type<TranslatedEntity>(),
    createdAt: int("created_at").notNull(),
    // On a tombstone, when the draft added the localization back.
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("localization_exclusions_live_id_idx")
      .on(table.id, table.locale)
      .where(sql`${table.draftId} is null`),
    uniqueIndex("localization_exclusions_draft_id_idx")
      .on(table.draftId, table.id, table.locale)
      .where(sql`${table.draftId} is not null`),
    index("localization_exclusions_project_idx").on(table.projectId),
  ],
);
