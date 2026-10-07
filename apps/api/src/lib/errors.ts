import { Data, Effect } from "effect";
import type { z } from "zod";

import type { CompatibilityReason } from "../domains/environments/service";

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

export class NotFoundError extends Data.TaggedError("NotFoundError")<OptionalMessage> {
  constructor(args: OptionalMessage = {}) {
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

/** Push/pull was refused because the two environments' schemas diverge. */
export class IncompatibleEnvironmentsError extends Data.TaggedError(
  "IncompatibleEnvironmentsError",
)<{
  readonly reasons: CompatibilityReason[];
}> {}

export type ServiceError =
  | UnauthenticatedError
  | ForbiddenError
  | NotFoundError
  | InvalidInputError
  | ConflictError
  | IncompatibleEnvironmentsError;

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
