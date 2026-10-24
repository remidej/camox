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
   * content access (`accessTo`), which knows the project.
   */
  draft: DraftRequest | null;
  /**
   * The draft a publish with code's Worker version names on its public reads, through
   * `x-camox-publishing-draft`: a request naming no draft reads Live overlaid with it while it
   * publishes, and Live otherwise (`accessTo`).
   */
  publishingDraft?: string;
  /**
   * The locale the request reads and writes content in, by its tag, through `x-camox-locale` or
   * an AI tool's `locale`. Absent means the default locale (ADR 0015). Content access checks
   * that the draft has it.
   */
  locale?: string;
  /**
   * The project the request is bound to, such as an AI tool session's: content access reads
   * every other project's content as missing.
   */
  projectId?: number;
};
