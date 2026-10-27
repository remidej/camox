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
    /** The project's social profile URLs, in order: a Project Setting, outside drafts. */
    socialProfiles: text("social_profiles", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    /**
     * An Upgrade ready to push to `main`, waiting in the project's queue of publishes with code
     * (`../publishes/queue.ts`): its project Workflow's instance, and when it joined.
     */
    upgradePushInstanceId: text("upgrade_push_instance_id"),
    upgradePushRequestedAt: int("upgrade_push_requested_at"),
    /**
     * A publish with code whose batch committed, still pushing its tree to `main`: it keeps its
     * place in the project's queue (`../publishes/queue.ts`) until that push landed, its draft's
     * row being gone. Its publish Workflow's instance, and when its publish was asked for.
     */
    publishPushInstanceId: text("publish_push_instance_id"),
    publishPushRequestedAt: int("publish_push_requested_at"),
    /**
     * The user Worker serving the project's website, when a publish with code put its own there
     * (`../publishes/scripts.ts`). Null for the one named after its Project ID, which its releases
     * deploy. Dispatch reads it through the API (apps/dispatch/src/live-script.ts).
     */
    liveScript: text("live_script"),
    /**
     * Whether the project's code can be worked on outside Camox: its organization's members can
     * clone its repo and push commits to its drafts from their own checkout (ADR 0026). Off by
     * default, and set by hand in the database.
     */
    codeOutsideCamox: int("code_outside_camox", { mode: "boolean" }).notNull().default(false),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("projects_uuid_idx").on(table.uuid),
    uniqueIndex("projects_slug_idx").on(table.slug),
    index("projects_organization_idx").on(table.organizationId),
  ],
);
