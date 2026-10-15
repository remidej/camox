import { index, int, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "../auth/schema";
import { environments, projects } from "../projects/schema";

export const pages = sqliteTable(
  "pages",
  {
    id: int().primaryKey({ autoIncrement: true }),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    environmentId: int("environment_id")
      .notNull()
      .references(() => environments.id),
    pathSegment: text("path_segment").notNull(),
    fullPath: text("full_path").notNull(),
    parentPageId: int("parent_page_id"),
    // The layout's name.
    layoutId: text("layout_id").notNull(),
    nickname: text("nickname").notNull(),
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    aiSeoEnabled: int("ai_seo_enabled", { mode: "boolean" }),
    customOgImageBlobId: text("custom_og_image_blob_id"),
    customOgImageUrl: text("custom_og_image_url"),
    // FK to page_checkpoints.id is declared in checkpoints-schema.ts to avoid
    // the circular import between pages and page_checkpoints.
    livePublishedCheckpointId: int("live_published_checkpoint_id"),
    contentUpdatedAt: int("content_updated_at").notNull(),
    createdById: text("created_by_id").references(() => user.id),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    index("pages_full_path_idx").on(table.fullPath),
    index("pages_parent_idx").on(table.parentPageId),
    index("pages_project_idx").on(table.projectId),
    index("pages_environment_full_path_idx").on(table.environmentId, table.fullPath),
  ],
);
