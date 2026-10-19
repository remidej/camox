import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { organizationTable } from "../auth/schema";

export const projects = sqliteTable(
  "projects",
  {
    id: int().primaryKey({ autoIncrement: true }),
    slug: text().notNull(),
    name: text().notNull(),
    deployToken: text("deploy_token").notNull().default(""),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id),
    /** The project's Google Analytics 4 measurement ID: a Project Setting, outside drafts. */
    ga4MeasurementId: text("ga4_measurement_id"),
    /** The project's PostHog project API key, set together with its region: a Project Setting. */
    posthogProjectApiKey: text("posthog_project_api_key"),
    posthogRegion: text("posthog_region", { enum: ["us", "eu"] }),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("projects_slug_idx").on(table.slug),
    index("projects_organization_idx").on(table.organizationId),
  ],
);
