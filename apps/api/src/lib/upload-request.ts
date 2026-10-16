import { DEVELOPMENT_DRAFT, DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { uuidv7Schema } from "@camox/api-contract/ids";
import { ORPCError } from "@orpc/server";
import type { Effect } from "effect";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ServiceContext } from "../domains/_shared/service-context";
import type { DraftRequest } from "../domains/drafts/scope";
import type { AppEnv } from "../types";
import { LiveReadOnlyError, type ServiceError } from "./errors";
import { runService, toORPCError } from "./run-service";

// Uploads write content outside oRPC (multipart Hono routes), so they read the draft headers
// themselves. Like any content write they need a draft: Live is read-only, and the create
// header starts one (ADR 0011).

/** The draft an upload names in its headers, like any oRPC request. */
function draftRequestOf(headers: Headers): DraftRequest | null | "invalid" {
  const id = headers.get(DRAFT_HEADER);
  if (!id) return null;
  if (id === DEVELOPMENT_DRAFT) return { development: true };
  if (!uuidv7Schema.safeParse(id).success) return "invalid";
  return { id, create: headers.get(DRAFT_CREATE_HEADER) === "1" };
}

/**
 * The service context of a signed-in upload in the draft it names, or the response rejecting
 * an upload naming no valid draft.
 */
export function uploadContextOf(
  c: Context<AppEnv>,
  user: NonNullable<ServiceContext["user"]>,
): ServiceContext | Response {
  const draft = draftRequestOf(c.req.raw.headers);
  if (draft === "invalid") {
    return c.json({ error: `${DRAFT_HEADER} must be a UUIDv7 or "${DEVELOPMENT_DRAFT}"` }, 400);
  }
  if (!draft) {
    const error = toORPCError(new LiveReadOnlyError());
    return c.json({ error: error.message, code: error.code }, 409);
  }
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

/** Runs an upload's service, answering with its result or with its failure as oRPC would. */
export async function respondToUpload<A>(
  c: Context<AppEnv>,
  upload: Effect.Effect<A, ServiceError>,
  status: ContentfulStatusCode,
) {
  try {
    return c.json(await runService(upload), status);
  } catch (error) {
    if (!(error instanceof ORPCError)) throw error;
    return c.json(
      { error: error.message, code: error.code, data: error.data },
      error.status as ContentfulStatusCode,
    );
  }
}
