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
  OPEN_ROUTER_API_KEY: string;
  AI_JOB_SCHEDULER: DurableObjectNamespace;
  ProjectRoom: DurableObjectNamespace;
  THREAD: DurableObjectNamespace<import("./durable-objects/thread").Thread>;
  FILES_BUCKET: R2Bucket;
  MEDIA?: MediaBinding;
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
