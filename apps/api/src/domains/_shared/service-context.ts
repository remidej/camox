import type { Database } from "../../db";
import type { Bindings } from "../../types";
import type { Auth } from "../auth/routes";
import type { LookGrant } from "../drafts/look-token";
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
   * The draft a publish with code's own Worker names on its public reads, through
   * `x-camox-publishing-draft`: a request naming no draft reads Live overlaid with it while it
   * publishes, and Live otherwise (`accessTo`).
   */
  publishingDraft?: string;
  /**
   * What the valid look token the request carries through `x-camox-look-token` grants (ADR
   * 0032): a public read naming its draft reads it without a session (`accessTo`).
   */
  look?: LookGrant;
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
  /**
   * The API's public origin, which stored files' URLs start with: the request's, or for the
   * agent's thread, that of the requests connecting to it. Absent where nothing names it.
   */
  apiOrigin?: string;
};

/** The `client` of the context Camox's agent acts in. */
export const AGENT_CLIENT = "camox-agent";

/**
 * The context Camox's agent acts in, outside any request: as `user`, an editor or no one, in the
 * draft `draftId`, or else on Live.
 */
export function agentServiceContext({
  db,
  env,
  user,
  waitUntil,
  draftId = null,
  apiOrigin,
}: Pick<ServiceContext, "db" | "env" | "user" | "waitUntil" | "apiOrigin"> & {
  draftId?: string | null;
}): ServiceContext {
  return {
    db,
    user,
    env,
    waitUntil,
    client: AGENT_CLIENT,
    telemetryDisabled: false,
    apiOrigin,
    draft: draftId ? { id: draftId, create: false } : null,
  };
}
