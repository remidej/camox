import { PATROLLER_IDS } from "@camox/api-contract/patrol";
import { Effect } from "effect";
import { z } from "zod";

import { applyFix } from "../../../../apps/api/src/domains/patrol/fixes";
import { listFindings as openFindings } from "../../../../apps/api/src/domains/patrol/read";
import { runService } from "../../../../apps/api/src/lib/run-service";
import { findingSchema } from "../lib/outputs";
import { defineTool, type ToolDefinition, type ToolProvider } from "../types";

// The findings patrollers raise in the current draft (ADR 0034): reading them, and applying the
// fix one suggests, as a member would. Only members dismiss findings: no tool does.

/** A finding as listFindings returns it: with the patroller that raised it. */
const listedFindingSchema = findingSchema.extend({ patroller: z.enum(PATROLLER_IDS) });

const listInput = z.object({});
const applyInput = z.object({
  findingId: z.number().describe("The finding's `id`, as listFindings returns it."),
});

export const findingsProvider: ToolProvider = (ctx): ToolDefinition[] => [
  defineTool({
    name: "listFindings",
    description:
      "List the open findings in the current draft: problems the Patrol's patrollers found in " +
      "what the draft changed, like a link to a page that no longer exists, which hold its " +
      "publish until fixed or dismissed by a member. Returns `{ findings }`, the oldest first, " +
      "each with its `id`, the `patroller` that raised it, what it's `about` (by `kind`: " +
      "`missingPage` and `brokenLink` name the link's `url` and the `text` it reads), the " +
      "`fix` it suggests or null, and where it is: its `subject` (`entity`, `id`, `name`), `locale` tag " +
      "and content `field`. On Live, lists Live's findings. You can't dismiss a finding: only " +
      "members can, from the Patrol.",
    inputSchema: listInput,
    outputSchema: z.strictObject({ findings: z.array(listedFindingSchema) }),
    meta: { kind: "read", surfaces: ["cli", "studio-agent"] },
    handler: async () =>
      runService(
        openFindings(ctx, { projectId: ctx.projectId }).pipe(
          Effect.map((found) => ({
            findings: found.map(({ id, patroller, about, fix, subject, locale, field }) => ({
              id,
              patroller,
              about,
              fix,
              subject,
              locale,
              field,
            })),
          })),
        ),
      ),
  }),
  defineTool({
    name: "applyFindingFix",
    description:
      "Apply the fix a finding of the current draft suggests (its `fix`, from listFindings), as " +
      "a member would from the Patrol: `removeLink` unwraps the link, keeping its text. Returns " +
      "`{ applied: true }` once applied, which resolves the finding. When its content changed " +
      "since the finding was raised, nothing is applied and it returns `{ applied: false }`: the " +
      "draft is checked again, so list its findings again later. A finding without a `fix` " +
      "needs editing its content yourself.",
    inputSchema: applyInput,
    outputSchema: z.strictObject({ applied: z.boolean() }),
    meta: { kind: "write", surfaces: ["cli", "studio-agent"] },
    handler: async (input) => {
      const { findingId } = applyInput.parse(input);
      return runService(applyFix(ctx, { projectId: ctx.projectId, findingId }));
    },
  }),
];
