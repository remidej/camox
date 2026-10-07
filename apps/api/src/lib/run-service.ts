import { ORPCError } from "@orpc/server";
import { Cause, Effect, Exit, Option } from "effect";

import type { ServiceError } from "./errors";

/** Translate a typed service failure into its wire representation. */
export function toORPCError(error: ServiceError) {
  switch (error._tag) {
    case "UnauthenticatedError":
      return new ORPCError("UNAUTHORIZED", { message: error.message });
    case "ForbiddenError":
      return new ORPCError("FORBIDDEN", { message: error.message });
    case "NotFoundError":
      return new ORPCError("NOT_FOUND", { message: error.message });
    case "InvalidInputError":
      return new ORPCError("BAD_REQUEST", { message: error.message, data: error.data });
    case "ConflictError":
      return new ORPCError("CONFLICT", { message: error.message });
    case "IncompatibleEnvironmentsError":
      return new ORPCError("FAILED_PRECONDITION", {
        message: "Environments are incompatible — see data.reasons.",
        data: { reasons: error.reasons },
      });
  }
}

/**
 * Run a service effect at a Promise boundary (oRPC handlers, Hono routes,
 * durable objects, AI tools). Expected failures reject with the matching
 * `ORPCError`; defects reject with the original thrown value so the
 * transport logs them and answers with a 500.
 */
export async function runService<A>(effect: Effect.Effect<A, ServiceError>): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;

  const error = Cause.findErrorOption(exit.cause);
  if (Option.isSome(error)) throw toORPCError(error.value);
  throw Cause.squash(exit.cause);
}
