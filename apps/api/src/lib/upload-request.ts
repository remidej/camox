import type { Effect } from "effect";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ServiceContext } from "../domains/_shared/service-context";
import type { AppEnv } from "../types";
import { draftRequestOf, INVALID_DRAFT_HEADER } from "./draft-request";
import { LiveReadOnlyError, type ServiceError } from "./errors";
import { respondToService, routeServiceContext } from "./route-service";
import { type ServiceRequirements, toORPCError } from "./run-service";

// Uploads write content outside oRPC (multipart Hono routes), so they read the draft headers
// themselves. Like any content write they need a draft: Live is read-only, and the create
// header starts one (ADR 0011).

/**
 * The service context of a signed-in upload in the draft it names, or the response rejecting
 * an upload naming no valid draft.
 */
export function uploadContextOf(
  c: Context<AppEnv>,
  user: NonNullable<ServiceContext["user"]>,
): ServiceContext | Response {
  const draft = draftRequestOf(c.req.raw.headers);
  if (draft === "invalid") return c.json({ error: INVALID_DRAFT_HEADER }, 400);
  if (!draft) {
    const error = toORPCError(new LiveReadOnlyError());
    return c.json({ error: error.message, code: error.code }, 409);
  }
  return routeServiceContext(c, user, draft);
}

/** Runs an upload's service, answering with its result or with its failure as oRPC would. */
export const respondToUpload = <A>(
  c: Context<AppEnv>,
  upload: Effect.Effect<A, ServiceError, ServiceRequirements>,
  status: ContentfulStatusCode,
) => respondToService(c, upload, (result) => c.json(result, status));
