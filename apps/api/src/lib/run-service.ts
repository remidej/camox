import {
  CONFLICTS_CHANGED_ERROR,
  DRAFT_ENDED_ERROR_CODE,
  DRAFT_HEADER,
  LIVE_READ_ONLY_ERROR,
  PUBLISH_BLOCKED_ERROR,
  REVISION_CHANGED_ERROR,
  TRANSLATIONS_PENDING_ERROR,
  FINDINGS_OPEN_ERROR,
  CHECKS_RUNNING_ERROR,
} from "@camox/api-contract/drafts";
import { ORPCError } from "@orpc/server";
import { Cause, Effect, Exit, Option } from "effect";

import { PUSH_REFUSED_ERROR } from "../domains/code-pushes/refusal";
import { catchUpReleaseWrites } from "../domains/drafts/catch-up";
import { requestOverviewsOfWrites } from "../domains/drafts/overview";
import { requestChecksOfWrites } from "../domains/patrol/checks";
import { proofreadReleaseWrites } from "../domains/patrol/proofreader";
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
    case "ConflictsChangedError":
      return new ORPCError(CONFLICTS_CHANGED_ERROR, { status: 409, message: error.message });
    case "PublishBlockedError":
      return new ORPCError(PUBLISH_BLOCKED_ERROR, { status: 422, message: error.message });
    case "RevisionChangedError":
      return new ORPCError(REVISION_CHANGED_ERROR, { status: 409, message: error.message });
    case "PushRefusedError":
      return new ORPCError(PUSH_REFUSED_ERROR, {
        status: 422,
        message: error.message,
        data: { reason: error.reason, ...error.data },
      });
    case "TranslationsPendingError":
      return new ORPCError(TRANSLATIONS_PENDING_ERROR, {
        status: 409,
        message: error.message,
        data: { translating: error.translating },
      });
    case "FindingsOpenError":
      return new ORPCError(FINDINGS_OPEN_ERROR, { status: 422, message: error.message });
    case "ChecksRunningError":
      return new ORPCError(CHECKS_RUNNING_ERROR, {
        status: 409,
        message: error.message,
        data: { checking: error.checking },
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
 * a draft's default locale is translated into the draft's other locales, and
 * what a release wrote on Live into Live's in Camox's catch-up draft (ADR
 * 0017), and proofread on Live once the release is done (ADR 0034). The
 * overview and the at-publish checks of every draft it wrote in are requested,
 * and what it changed is sent to the project rooms before the promise
 * resolves; a failure sends nothing. It generates values and translations with
 * the Worker's model and job queue (`ai-adapters.ts`).
 */
export async function runService<A>(
  effect: Effect.Effect<A, ServiceError, ServiceRequirements>,
): Promise<A> {
  const work = Effect.tap(effect, () =>
    Effect.andThen(translateWrites(), catchUpReleaseWrites()).pipe(
      Effect.andThen(proofreadReleaseWrites()),
      Effect.andThen(requestOverviewsOfWrites()),
      Effect.andThen(requestChecksOfWrites()),
    ),
  );
  const exit = await Effect.runPromiseExit(
    journaled(Effect.provideContext(work, aiServices()), announce),
  );
  if (Exit.isSuccess(exit)) return exit.value;

  const error = Cause.findErrorOption(exit.cause);
  if (Option.isSome(error)) throw toORPCError(error.value);
  throw Cause.squash(exit.cause);
}
