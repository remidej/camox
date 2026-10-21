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
  AI_JOB_SCHEDULER: DurableObjectNamespace;
  ProjectRoom: DurableObjectNamespace;
  THREAD: DurableObjectNamespace<import("./durable-objects/thread").Thread>;
  /** The sandbox Worker's Durable Object running code mode scripts, one per thread (ADR 0018). */
  CODEMODE_SANDBOX: DurableObjectNamespace<
    import("@earendil-works/pi-codemode/cloudflare").CodemodeSandboxDurableObject
  >;
  FILES_BUCKET: R2Bucket;
  MEDIA?: MediaBinding;
  /** The `projects` Cloudflare Artifacts namespace: every project's repo, and the Template's. */
  ARTIFACTS: Artifacts;
  RELEASE_WORKFLOW: Workflow;
  /** The release sandbox Worker's Container sandboxes, one per release step. */
  SANDBOX: DurableObjectNamespace<import("@cloudflare/ci/worker").CiSandbox>;
  /** Where the release sandboxes keep their workspace snapshots, which cache installs. */
  BACKUP_BUCKET: R2Bucket;
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
