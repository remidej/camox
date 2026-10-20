import { ORPCError } from "@orpc/server";
import type { Effect } from "effect";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ServiceContext } from "../domains/_shared/service-context";
import type { DraftRequest } from "../domains/drafts/scope";
import type { AppEnv } from "../types";
import type { ServiceError } from "./errors";
import { runService, type ServiceRequirements } from "./run-service";

// Some routes run services outside oRPC (multipart uploads, WebSocket upgrades): these build
// their context and answer their failures as oRPC procedures do.

/** The service context of a signed-in Hono route acting in `draft`, or on Live without one. */
export function routeServiceContext<D extends DraftRequest | null>(
  c: Context<AppEnv>,
  user: NonNullable<ServiceContext["user"]>,
  draft: D,
): ServiceContext & { draft: D } {
  return {
    db: c.var.db,
    user,
    env: c.env,
    client: c.var.client ?? "unknown",
    telemetryDisabled: c.var.telemetryDisabled ?? false,
    draft,
    waitUntil: (promise) => c.executionCtx.waitUntil(promise),
  };
}

/**
 * Runs a Hono route's service, answering with `respond` given its result, or with its failure as
 * oRPC would.
 */
export async function respondToService<A>(
  c: Context<AppEnv>,
  service: Effect.Effect<A, ServiceError, ServiceRequirements>,
  respond: (result: A) => Response | Promise<Response>,
) {
  let result: A;
  try {
    result = await runService(service);
  } catch (error) {
    if (!(error instanceof ORPCError)) throw error;
    return c.json(
      { error: error.message, code: error.code, data: error.data },
      error.status as ContentfulStatusCode,
    );
  }
  return respond(result);
}
