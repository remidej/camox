import { Effect } from "effect";
import { z } from "zod";

import {
  checkCompatibility,
  replicateEnvironment,
} from "../../../../apps/api/src/domains/environments/service";
import { InvalidInputError } from "../../../../apps/api/src/lib/errors";
import { runService } from "../../../../apps/api/src/lib/run-service";
import type { ToolContext, ToolDefinition, ToolProvider } from "../types";

const PRODUCTION_ENV = "production";

const checkInput = z.object({});

const replicateInput = z.object({
  direction: z.enum(["push", "pull"]),
});

/**
 * Compute the source/target env pair for a push/pull op, using the ambient
 * environment as the dev side. Rejects when the caller is already on
 * production — same precondition the studio's EnvironmentMenu enforces via
 * `canReplicate = !isProduction`.
 */
const resolvePair = Effect.fn("resolvePair")(function* (
  ctx: ToolContext,
  direction: "push" | "pull",
) {
  if (ctx.environmentName === PRODUCTION_ENV) {
    return yield* new InvalidInputError({
      message:
        "Push/pull operate between your dev environment and production, " +
        "but the current environment is already production.",
    });
  }
  return direction === "push"
    ? { sourceEnvName: ctx.environmentName, targetEnvName: PRODUCTION_ENV }
    : { sourceEnvName: PRODUCTION_ENV, targetEnvName: ctx.environmentName };
});

export const environmentsProvider: ToolProvider = (ctx): ToolDefinition[] => [
  {
    name: "checkEnvironmentCompatibility",
    description:
      "Check whether the current dev environment can push to and pull from production. " +
      "Returns `{ push: { compatible, reasons }, pull: { compatible, reasons } }`. " +
      "Each `reasons` array lists the block-definition / layout divergences blocking that direction (empty when compatible).",
    inputSchema: checkInput,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: async () =>
      runService(
        Effect.gen(function* () {
          const push = yield* resolvePair(ctx, "push");
          const pull = yield* resolvePair(ctx, "pull");
          return yield* Effect.all(
            {
              push: checkCompatibility(ctx, { projectId: ctx.projectId, ...push }),
              pull: checkCompatibility(ctx, { projectId: ctx.projectId, ...pull }),
            },
            { concurrency: "unbounded" },
          );
        }),
      ),
  },
  {
    name: "replicateEnvironment",
    description:
      "Replicate content between the current dev environment and production. " +
      "`direction: 'push'` overwrites production with the dev env; `direction: 'pull'` overwrites the dev env with production. " +
      "Destructive — every page, block, and file in the target environment is replaced. " +
      "Fails with FAILED_PRECONDITION (and a `data.reasons` array) when the environments are incompatible; call checkEnvironmentCompatibility first if you want to inspect divergences without attempting the copy.",
    inputSchema: replicateInput,
    meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
    handler: async (input) => {
      const { direction } = replicateInput.parse(input);
      return runService(
        resolvePair(ctx, direction).pipe(
          Effect.flatMap((pair) =>
            replicateEnvironment(ctx, { projectId: ctx.projectId, ...pair }),
          ),
        ),
      );
    },
  },
];
