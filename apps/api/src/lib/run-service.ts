import {
  CONFLICTS_CHANGED_ERROR,
  DRAFT_ENDED_ERROR_CODE,
  DRAFT_HEADER,
  LIVE_READ_ONLY_ERROR,
  NO_DEVELOPMENT_DRAFT_ERROR,
  PUBLISH_BLOCKED_ERROR,
  TRANSLATIONS_PENDING_ERROR,
} from "@camox/api-contract/drafts";
import { ORPCError } from "@orpc/server";
import { Cause, Effect, Exit, Option } from "effect";

import { translateWrites } from "../domains/translations/service";
import { aiServices, type AiServices } from "./ai-adapters";
import type { ServiceError } from "./errors";
import { announce } from "./invalidation";
import { journaled, type Journal } from "./journal";

/** Translate a typed service failure into its wire representation. */
export function toORPCError(error: ServiceError) {
  switch (error._tag) {
    case "UnauthenticatedError":
      return new ORPCError("UNAUTHORIZED", { message: error.message });
    case "ForbiddenError":
      return new ORPCError("FORBIDDEN", { message: error.message });
    case "NotFoundError":
      return new ORPCError("NOT_FOUND", { message: error.message, data: error.data });
    case "InvalidInputError":
      return new ORPCError("BAD_REQUEST", { message: error.message, data: error.data });
    case "ConflictError":
      return new ORPCError("CONFLICT", { message: error.message });
    case "DraftEndedError":
      return new ORPCError(DRAFT_ENDED_ERROR_CODE, {
        status: 410,
        message: `This draft was ${error.ended.outcome}`,
        data: error.ended,
      });
    case "LiveReadOnlyError":
      return new ORPCError(LIVE_READ_ONLY_ERROR, {
        status: 409,
        message:
          error.message || `Live is read-only: content writes name a draft with ${DRAFT_HEADER}`,
      });
    case "NoDevelopmentDraftError":
      return new ORPCError(NO_DEVELOPMENT_DRAFT_ERROR, {
        status: 404,
        message:
          error.message ||
          "You have no development draft in this project yet: run the site locally first, so dev mode syncs your definitions and creates it",
      });
    case "ConflictsChangedError":
      return new ORPCError(CONFLICTS_CHANGED_ERROR, { status: 409, message: error.message });
    case "PublishBlockedError":
      return new ORPCError(PUBLISH_BLOCKED_ERROR, { status: 422, message: error.message });
    case "TranslationsPendingError":
      return new ORPCError(TRANSLATIONS_PENDING_ERROR, {
        status: 409,
        message: error.message,
        data: { translating: error.translating },
      });
  }
}

/** What every unit of work runs with: its journal, and the services that generate values. */
export type ServiceRequirements = Journal | AiServices;

/**
 * Run a service effect at a Promise boundary (oRPC handlers, Hono routes,
 * durable objects, AI tools): one unit of work. Expected failures reject with
 * the matching `ORPCError`; defects reject with the original thrown value so
 * the transport logs them and answers with a 500.
 *
 * The effect writes into a fresh journal. Once it succeeded, what it wrote in
 * a draft's default locale is translated into the draft's other locales (ADR
 * 0015), and what it changed is sent to the project rooms before the promise
 * resolves; a failure sends nothing. It generates values and translations with
 * the Worker's model and job queue (`ai-adapters.ts`).
 */
export async function runService<A>(
  effect: Effect.Effect<A, ServiceError, ServiceRequirements>,
): Promise<A> {
  const work = Effect.tap(effect, () => translateWrites());
  const exit = await Effect.runPromiseExit(
    journaled(Effect.provideContext(work, aiServices()), announce),
  );
  if (Exit.isSuccess(exit)) return exit.value;

  const error = Cause.findErrorOption(exit.cause);
  if (Option.isSome(error)) throw toORPCError(error.value);
  throw Cause.squash(exit.cause);
}
