import type { Database } from "../../db";
import type { Bindings } from "../../types";
import type { Auth } from "../auth/routes";
import type { DraftRequest } from "../drafts/scope";

export type ServiceContext = {
  db: Database;
  user: Auth["$Infer"]["Session"]["user"] | null;
  env: Bindings;
  waitUntil: (promise: Promise<unknown>) => void;
  /**
   * Free-form identifier for the calling client, set from the `X-Camox-Client`
   * request header. Known values: "studio", "cli", "mcp:<name>", "camox-agent",
   * or "unknown" when no header was sent. Used for analytics attribution.
   */
  client: string;
  /**
   * Honors the user's `disableTelemetry` vite plugin option. When true, the
   * server skips emission for events triggered by this request. Forwarded
   * through `X-Camox-Telemetry-Disabled` from CLI and studio paths.
   */
  telemetryDisabled: boolean;
  /**
   * The draft the request names through `x-camox-draft`, not yet checked against the
   * caller or a project. `null` means Live. Services turn it into a `DraftScope` with
   * `requireDraftScope` once they know the project.
   */
  draft: DraftRequest | null;
};
