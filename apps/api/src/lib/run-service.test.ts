import { ORPCError } from "@orpc/server";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  ConflictError,
  IncompatibleEnvironmentsError,
  InvalidInputError,
  NotFoundError,
  UnauthenticatedError,
} from "./errors";
import { runService } from "./run-service";

describe("runService", () => {
  it("resolves with the success value", async () => {
    await expect(runService(Effect.succeed(42))).resolves.toBe(42);
  });

  it("maps tagged failures to their ORPCError code and message", async () => {
    const cases = [
      [new UnauthenticatedError(), "UNAUTHORIZED", "Unauthorized"],
      [new NotFoundError(), "NOT_FOUND", "Not Found"],
      [
        new NotFoundError({ message: 'Environment "dev" not found' }),
        "NOT_FOUND",
        'Environment "dev" not found',
      ],
      [new ConflictError({ message: "Path taken" }), "CONFLICT", "Path taken"],
    ] as const;

    for (const [error, code, message] of cases) {
      const rejection = await runService(Effect.fail(error)).catch((e: unknown) => e);
      expect(rejection).toBeInstanceOf(ORPCError);
      expect(rejection).toMatchObject({ code, message });
    }
  });

  it("forwards structured error data", async () => {
    const invalid = await runService(
      Effect.fail(new InvalidInputError({ message: "Bad field", data: { field: "title" } })),
    ).catch((e: unknown) => e);
    expect(invalid).toMatchObject({ code: "BAD_REQUEST", data: { field: "title" } });

    const reasons = [{ kind: "collections-replication-unsupported" as const }];
    const incompatible = await runService(
      Effect.fail(new IncompatibleEnvironmentsError({ reasons })),
    ).catch((e: unknown) => e);
    expect(incompatible).toMatchObject({ code: "FAILED_PRECONDITION", data: { reasons } });
  });

  it("rethrows defects untouched so the transport answers with a 500", async () => {
    const defect = new Error("D1 unavailable");
    const rejection = await runService(Effect.die(defect)).catch((e: unknown) => e);
    expect(rejection).toBe(defect);
  });
});
