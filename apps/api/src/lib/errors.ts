import type { EndedDraft } from "@camox/api-contract/drafts";
import { Data, Effect } from "effect";
import type { z } from "zod";

// --- Expected service errors ---
//
// Services return `Effect<A, ServiceError>` and fail with one of these tagged
// errors for every outcome a caller can act on. Anything else — database
// failures, broken invariants, bugs — is a defect (`Effect.promise`,
// `Effect.die`) and surfaces as a 500 at the transport boundary.

type OptionalMessage = { readonly message?: string };

/** The caller has no session, or presented an invalid credential. */
export class UnauthenticatedError extends Data.TaggedError(
  "UnauthenticatedError",
)<OptionalMessage> {
  constructor(args: OptionalMessage = {}) {
    super(args);
  }
}

/** The caller is authenticated but not allowed to touch the resource. */
export class ForbiddenError extends Data.TaggedError("ForbiddenError")<OptionalMessage> {
  constructor(args: OptionalMessage = {}) {
    super(args);
  }
}

type NotFoundArgs = OptionalMessage & {
  /** What the caller needs to tell this apart from other missing things, such as `draftId`. */
  readonly data?: Record<string, unknown>;
};

export class NotFoundError extends Data.TaggedError("NotFoundError")<NotFoundArgs> {
  constructor(args: NotFoundArgs = {}) {
    super(args);
  }
}

/** The input is well-formed but violates a domain rule. */
export class InvalidInputError extends Data.TaggedError("InvalidInputError")<{
  readonly message: string;
  readonly data?: Record<string, unknown>;
}> {}

/** The write would collide with existing state (duplicate path, stale version, …). */
export class ConflictError extends Data.TaggedError("ConflictError")<{
  readonly message: string;
}> {}

/** The request names a draft that was published or deleted (ADR 0009). */
export class DraftEndedError extends Data.TaggedError("DraftEndedError")<{
  readonly ended: EndedDraft;
}> {}

/** A content write names no draft: Live is read-only (ADR 0003). */
export class LiveReadOnlyError extends Data.TaggedError("LiveReadOnlyError")<OptionalMessage> {
  constructor(args: OptionalMessage = {}) {
    super(args);
  }
}

/** Live changed since the publish preview the caller confirmed, so nothing was published. */
export class ConflictsChangedError extends Data.TaggedError("ConflictsChangedError")<{
  readonly message: string;
}> {}

/**
 * A publish of a draft with code named a revision that isn't the draft's head, or the draft is
 * publishing already: the caller reviews the new preview.
 */
export class RevisionChangedError extends Data.TaggedError("RevisionChangedError")<{
  readonly message: string;
}> {}

/** The draft still has blockers, so it can't be published. */
export class PublishBlockedError extends Data.TaggedError("PublishBlockedError")<{
  readonly message: string;
}> {}

/**
 * The draft still has pending translations, which publishing waits for: every locale goes live
 * together (ADR 0033).
 */
export class TranslationsPendingError extends Data.TaggedError("TranslationsPendingError")<{
  readonly message: string;
  /** The tags of the locales still translating. */
  readonly translating: readonly string[];
}> {}

/**
 * A member's push was refused, writing nothing (ADR 0026): `reason` is its stable code, and a
 * push that doesn't build has its build's errors.
 */
export class PushRefusedError extends Data.TaggedError("PushRefusedError")<{
  readonly reason: string;
  readonly message: string;
  readonly data?: Record<string, unknown>;
}> {}

export type ServiceError =
  | UnauthenticatedError
  | ForbiddenError
  | NotFoundError
  | InvalidInputError
  | ConflictError
  | DraftEndedError
  | LiveReadOnlyError
  | ConflictsChangedError
  | PublishBlockedError
  | RevisionChangedError
  | TranslationsPendingError
  | PushRefusedError;

// --- Helpers ---

/** Parse service input, failing with `InvalidInputError` instead of throwing. */
export function decodeInput<S extends z.ZodType>(schema: S, input: unknown) {
  const result = schema.safeParse(input);
  if (result.success) return Effect.succeed(result.data as z.output<S>);
  return Effect.fail(
    new InvalidInputError({
      message: "Input did not match the expected schema",
      data: { issues: result.error.issues },
    }),
  );
}
