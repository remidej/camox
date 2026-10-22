import type { PosthogRegion } from "@camox/api-contract/analytics";
import { generateUuidv7 } from "@camox/api-contract/ids";
import type { ProjectSetupStep, ProjectStatus } from "@camox/api-contract/projects";
import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { organizationTable } from "../auth/schema";

export const projects = sqliteTable(
  "projects",
  {
    /** The internal key: foreign keys and project rooms use it, code and the platform never do. */
    id: int().primaryKey({ autoIncrement: true }),
    /**
     * The project's Project ID: a lowercase UUIDv7, given when the project is created and never
     * changed. Code and the platform name the project by it (ADR 0004).
     */
    uuid: text().notNull().$defaultFn(generateUuidv7),
    slug: text().notNull(),
    name: text().notNull(),
    deployToken: text("deploy_token").notNull().default(""),
    /** `settingUp` until its first release succeeds, then `live`, or `setupFailed`. */
    status: text().$type<ProjectStatus>().notNull().default("live"),
    /** The setup step underway, or the one that failed, while the project isn't live. */
    setupStep: text("setup_step").$type<ProjectSetupStep>(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id),
    /** The project's Google Analytics 4 measurement ID: a Project Setting, outside drafts. */
    ga4MeasurementId: text("ga4_measurement_id"),
    /** The project's PostHog project API key, set together with its region: a Project Setting. */
    posthogProjectApiKey: text("posthog_project_api_key"),
    posthogRegion: text("posthog_region").$type<PosthogRegion>(),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("projects_uuid_idx").on(table.uuid),
    uniqueIndex("projects_slug_idx").on(table.slug),
    index("projects_organization_idx").on(table.organizationId),
  ],
);
