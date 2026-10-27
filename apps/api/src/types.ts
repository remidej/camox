import type { Database } from "./db";
import type { Auth } from "./domains/auth/routes";

export type Bindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  DASHBOARD_URL: string;
  EMAIL: SendEmail;
  /** Where alerts go, such as a failed release's. Cloudflare Email Routing forwards it. */
  ALERT_EMAIL_TO: string;
  OPEN_ROUTER_API_KEY: string;
  /** Camox's Google Fonts Developer API key, which the daily fonts snapshot is taken with. */
  GOOGLE_FONTS_API_KEY: string;
  /** Workers AI, which the agent's web tools search and convert pages to Markdown with. */
  AI: Ai;
  AI_JOB_SCHEDULER: DurableObjectNamespace;
  ProjectRoom: DurableObjectNamespace;
  /** Batches the edge cache's purges, which the account's purge rate limit caps. */
  EDGE_CACHE_PURGER: import("./lib/edge-cache-purges").EdgeCachePurgerNamespace;
  THREAD: DurableObjectNamespace<import("./durable-objects/thread").Thread>;
  /** A read-only copy of each project's `main`, by Project ID, which the agent reads code from. */
  PROJECT_CODE: DurableObjectNamespace<import("./durable-objects/project-code").ProjectCode>;
  /** Each draft with code's working copy, by the draft's ID, which the agent changes code in. */
  DRAFT_CODE: DurableObjectNamespace<import("./durable-objects/draft-code").DraftCode>;
  /** The sandbox Worker's Durable Object running code mode scripts, one per thread (ADR 0018). */
  CODEMODE_SANDBOX: DurableObjectNamespace<
    import("@earendil-works/pi-codemode/cloudflare").CodemodeSandboxDurableObject
  >;
  FILES_BUCKET: R2Bucket;
  /** Project Slug → Project ID: which project each `<slug>.camox.site` host serves. */
  PROJECT_SLUGS: KVNamespace;
  MEDIA?: MediaBinding;
  /** The `projects` Cloudflare Artifacts namespace: every project's repo, and the Template's. */
  ARTIFACTS: Artifacts;
  RELEASE_WORKFLOW: Workflow;
  /** Copies the Template into a new project's repo, named after its Project ID. */
  PROJECT_CREATION_WORKFLOW: Workflow<
    import("./domains/project-creation/workflow").ProjectCreationParams
  >;
  /** Deletes a deleted project's Worker and repo, named after its Project ID. */
  PROJECT_DELETION_WORKFLOW: Workflow<
    import("./domains/project-deletion/workflow").ProjectDeletionParams
  >;
  /** Moves every project to a newly published SDK, one project upgrade each. */
  UPGRADE_WORKFLOW: Workflow<import("./domains/upgrades/workflow").UpgradeParams>;
  /** Moves one project to a newly published SDK, and pushes it to `main` if it builds. */
  PROJECT_UPGRADE_WORKFLOW: Workflow<
    import("./domains/upgrades/project-workflow").ProjectUpgradeParams
  >;
  /** The release sandbox Worker's Container sandboxes, one per release step. */
  SANDBOX: DurableObjectNamespace<import("@cloudflare/ci/worker").CiSandbox>;
  /** Where the release sandboxes keep their workspace snapshots, which cache installs. */
  BACKUP_BUCKET: R2Bucket;
  /** The release sandbox Worker's Container sandboxes revisions build in, one per draft with code. */
  REVISION_SANDBOX: DurableObjectNamespace<import("@cloudflare/sandbox").Sandbox>;
  /** Publishes a draft with code: its revision's build, content and definitions together. */
  PUBLISH_WORKFLOW: Workflow<import("./domains/publishes/workflow").PublishParams>;
  /** Each revision's build, one archive per revision (`revisionArchiveKey`). */
  REVISION_BUILDS: R2Bucket;
  /** The skills each `camox` version ships, one object per version (`domains/code/skills.ts`). */
  SKILLS: R2Bucket;
  /** The dispatch Worker, which loads revisions (`domains/revisions/dispatch.ts`). */
  DISPATCH: import("./domains/revisions/dispatch").Dispatch;
  /** Camox's Cloudflare account, which serves every project's Worker. */
  CLOUDFLARE_ACCOUNT_ID: string;
  /** The Cloudflare API token that can deploy to the `production` dispatch namespace. */
  CF_TOKEN: string;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    db: Database;
    user: Auth["$Infer"]["Session"]["user"] | null;
    session: Auth["$Infer"]["Session"]["session"] | null;
    client: string;
    telemetryDisabled: boolean;
  };
};

declare global {
  namespace Cloudflare {
    /** The Worker's bindings, as `env` from `cloudflare:workers` holds them. */
    interface Env extends Bindings {}
  }
}
